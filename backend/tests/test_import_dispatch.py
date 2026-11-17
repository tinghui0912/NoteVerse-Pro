"""Import delivery, domain outcomes and current-attempt mutation authority."""

from app.db.models.import_job import ImportArtifactKind

from app.modules.import_jobs.requested_options import encode_requested_options

from app.modules.durable_work.failure import DurableFailure
from app.shared.durable_failure import DurableFailureClass


from contextlib import contextmanager
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import select, event
from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException
from app.db.models import (
    ImportDispatch,
    Notification,
    RealtimeChange,
    ImportDispatchStatus,
    ImportJob,
    ImportJobState,
    ImportJobStep,
    ImportJobUpload,
    StoredObject,
    Upload,
    ObjectWriteIntent,
    ImportArtifact,
    StorageUsageEvent,
    ExecutionManifest,
    User,
)
from app.modules.import_jobs import dispatch_service as dispatch_module, execution_manifest
from app.modules.import_jobs.dispatch_service import (
    ImportDispatchService,
    StaleImportDispatchAttempt,
)
from app.modules.import_jobs.execution_recorder import ImportExecutionRecorder
from app.modules.import_jobs.submission_service import ImportJobSubmissionService
from app.modules.storage_objects.writes import write_object
from app.modules.import_jobs.pipeline.context import JobContext
from app.modules.import_jobs.pipeline.step_tracker import StepTracker
from app.task_queue.tracing import import_dispatch_trace_context
from app.shared.time import utc_now
from tests.test_score_revision_services import score_service_session as score_service_session
from tests.support.write_cleanup import drain_write_cleanup


@pytest.fixture
def setup_delivery(score_service_session):
    db, storage = score_service_session
    job = ImportJob(
        job_uuid="import-domain",
        user_id=1,
        state=ImportJobState.QUEUED,
        requested_options=encode_requested_options({"display_title": "Current import"}),
    )
    physical = StoredObject(
        object_key="upload/original.png", byte_size=3, sha256="a" * 64, content_type="image/png"
    )
    db.add_all([job, physical])
    db.flush()
    upload = Upload(
        upload_uuid="original-upload",
        stored_object_id=physical.id,
        original_filename="original.png",
        uploader_user_id=1,
    )
    db.add(upload)
    db.flush()
    db.add(ImportJobUpload(job_id=job.id, upload_id=upload.id, page_number=1, sort_order=1))
    dispatch = ImportDispatch(
        job_id=job.id,
        originating_request_id="request-import",
        traceparent="00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
    )
    db.add(dispatch)
    db.commit()
    return db, storage, job, dispatch


def claim(db, row):
    payload = ImportDispatchService().claim(db, row.dispatch_uuid)
    db.commit()
    assert payload is not None
    return payload.lease


def expire(db, row):
    row.started_at = utc_now() - timedelta(
        seconds=dispatch_module.settings.IMPORT_PROCESSING_TIMEOUT_SECONDS + 1
    )
    db.add(row)
    db.commit()


def takeover(db, row):
    expire(db, row)
    assert ImportDispatchService().recover_and_list_due(db) == [row.dispatch_uuid]
    return claim(db, row)


def test_delivery_lifecycle_preserves_command_and_domain_identities(setup_delivery):
    db, _, job, row = setup_delivery
    service = ImportDispatchService()
    assert service.recover_and_list_due(db) == [row.dispatch_uuid]
    assert row.status == ImportDispatchStatus.PENDING
    assert service.mark_dispatched(db, row.dispatch_uuid)
    db.commit()
    assert row.status == ImportDispatchStatus.DISPATCHED
    payload = service.claim(db, row.dispatch_uuid)
    db.commit()
    assert payload.lease.dispatch_uuid == row.dispatch_uuid != job.job_uuid
    assert payload.job_uuid == payload.lease.job_uuid == job.job_uuid
    assert payload.attempt == row.attempt_count == 1
    assert payload.max_attempts == dispatch_module.settings.IMPORT_DISPATCH_MAX_ATTEMPTS
    assert payload.originating_request_id == row.originating_request_id
    assert payload.traceparent == row.traceparent
    assert service.claim(db, row.dispatch_uuid) is None
    assert not hasattr(payload, "options")
    assert [item.storage_key for item in payload.inputs] == ["upload/original.png"]
    assert row.attempt_token == payload.lease.token
    from app.modules.import_jobs.lifecycle import begin_processing, mark_ready_for_review

    begin_processing(job, now=utc_now())
    mark_ready_for_review(job, now=utc_now())
    db.add(job)
    db.commit()
    service.complete(db, payload.lease)
    db.commit()
    assert row.status == ImportDispatchStatus.COMPLETED
    assert row.completed_at and row.attempt_token is None
    assert service.claim(db, row.dispatch_uuid) is None
    assert service.recover_and_list_due(db) == []


def test_publish_release_changes_delivery_only(setup_delivery):
    db, _, job, row = setup_delivery
    job.current_step = "queued"
    db.add(job)
    db.commit()
    service = ImportDispatchService()
    assert service.mark_dispatched(db, row.dispatch_uuid)
    db.commit()
    service.release_dispatch(db, row.dispatch_uuid, "broker unavailable")
    db.commit()
    assert row.status == ImportDispatchStatus.PENDING
    assert row.attempt_count == 0 and row.dispatched_at is None
    assert row.failure_detail == "broker unavailable" and row.failure_code
    assert job.state == ImportJobState.QUEUED
    assert job.current_step == "queued" and job.failure_code is None


def test_expired_dispatch_preserves_domain_progress_and_steps(setup_delivery):
    db, _, job, row = setup_delivery
    service = ImportDispatchService()
    assert service.mark_dispatched(db, row.dispatch_uuid)
    row.dispatched_at = utc_now() - timedelta(
        seconds=dispatch_module.settings.IMPORT_DISPATCH_TIMEOUT_SECONDS + 1
    )
    job.progress, job.current_step = 17, "queued"
    db.add(ImportJobStep(job_id=job.id, step_order=1, name="queued", status="PENDING"))
    db.add_all([job, row])
    db.commit()
    assert service.recover_and_list_due(db) == [row.dispatch_uuid]
    assert row.status == ImportDispatchStatus.FAILED and row.attempt_count == 0
    assert job.progress == 17 and job.current_step == "queued"
    assert db.scalar(select(ImportJobStep)).name == "queued"


def test_expired_processing_resets_execution_and_preserves_inputs_and_binding(setup_delivery):
    db, _, job, row = setup_delivery
    lease = claim(db, row)
    manifest = ExecutionManifest(sha256="b" * 64, manifest={"engine": "test"})
    db.add(manifest)
    db.flush()
    job.execution_manifest_id = manifest.id
    job.state, job.progress, job.current_step = ImportJobState.PROCESSING, 73, "ocr"
    job.processing_started_at = job.processing_last_heartbeat_at = utc_now()
    db.add(ImportJobStep(job_id=job.id, step_order=1, name="ocr", status="RUNNING"))
    db.add(job)
    db.commit()
    expire(db, row)
    assert ImportDispatchService().recover_and_list_due(db) == [row.dispatch_uuid]
    assert row.status == ImportDispatchStatus.FAILED and row.attempt_count == lease.attempt
    assert row.failure_code == "import_dispatch_lease_expired"
    assert row.failure_classification == "transient" and row.failure_retryable is True
    assert row.attempt_token is None and row.next_attempt_at <= utc_now()
    assert job.state == ImportJobState.QUEUED and job.progress == 0
    assert (
        job.current_step
        is job.processing_started_at
        is job.processing_last_heartbeat_at
        is job.processing_finished_at
        is None
    )
    assert (
        job.failure_code
        is job.failure_stage
        is job.failure_classification
        is job.failure_retryable
        is job.failure_detail
        is None
    )
    assert job.execution_manifest_id == manifest.id
    assert job.requested_options == encode_requested_options({"display_title": "Current import"})
    assert db.scalar(select(ImportJobUpload)).job_id == job.id
    assert db.scalar(select(ImportJobStep)) is None


@pytest.mark.parametrize(
    "state", [ImportJobState.READY_FOR_REVIEW, ImportJobState.FAILED, ImportJobState.CONFIRMED]
)
def test_closed_execution_outcome_reconciles_expired_delivery_without_execution(
    setup_delivery, state
):
    db, _, job, row = setup_delivery
    claim(db, row)
    job.progress = 100
    if state == ImportJobState.CONFIRMED:
        from app.db.models import Score

        score = Score(score_uuid="confirmed-import", owner_user_id=1, display_title="Confirmed")
        db.add(score)
        db.flush()
        job.score_id = score.id
        job.confirmed_at = utc_now()
    job.processing_started_at = job.processing_finished_at = utc_now()
    job.state = state
    job.failure_code = "domain-result" if state == ImportJobState.FAILED else None
    job.failure_stage = "pipeline" if state == ImportJobState.FAILED else None
    job.failure_classification = "system_error" if state == ImportJobState.FAILED else None
    job.failure_retryable = False if state == ImportJobState.FAILED else None
    db.add(ImportJobStep(job_id=job.id, step_order=1, name="ocr", status="COMPLETED"))
    db.add(job)
    db.commit()
    expire(db, row)
    assert ImportDispatchService().recover_and_list_due(db) == []
    assert row.status == ImportDispatchStatus.COMPLETED and row.attempt_token is None
    assert job.state == state and job.progress == 100
    assert job.failure_code == ("domain-result" if state == ImportJobState.FAILED else None)
    assert db.scalar(select(ImportJobStep)).status.value == "COMPLETED"
    assert ImportDispatchService().claim(db, row.dispatch_uuid) is None


@pytest.mark.parametrize("processing_started", [False, True])
def test_exhausted_delivery_accepts_failure_with_the_observed_processing_start(
    setup_delivery, processing_started
):
    db, _, job, row = setup_delivery
    lease = claim(db, row)
    if processing_started:
        ImportExecutionRecorder().start_execution(db, lease)
    observed_start = job.processing_started_at
    assert job.processing_last_heartbeat_at is None
    row.attempt_count = dispatch_module.settings.IMPORT_DISPATCH_MAX_ATTEMPTS
    db.add_all([row, job])
    db.commit()
    expire(db, row)
    assert ImportDispatchService().recover_and_list_due(db) == []
    assert row.status == ImportDispatchStatus.FAILED and row.attempt_token is None
    assert row.failure_code == job.failure_code == "import_dispatch_attempts_exhausted"
    assert row.failure_retryable is job.failure_retryable is False
    assert job.state == ImportJobState.FAILED and job.processing_finished_at
    assert (job.processing_started_at is not None) is processing_started
    assert job.processing_started_at == observed_start
    assert job.processing_last_heartbeat_at is None
    assert job.failure_stage == "dispatch" and job.failure_detail
    assert db.scalar(select(Notification.kind)) == "import.failed"
    assert sorted(db.scalars(select(RealtimeChange.kind))) == [
        "import_jobs.changed",
        "notifications.changed",
    ]
    from app.modules.ops.query_service import OpsAsyncOperationQueryService
    from app.modules.ops.schemas import AsyncOperationKind

    projected = OpsAsyncOperationQueryService().get_operation(
        db, kind=AsyncOperationKind.IMPORT, operation_id=row.dispatch_uuid
    )
    assert projected.status.value == "failed"
    assert projected.failure.code == row.failure_code
    before = (row.status, row.attempt_count, row.completed_at, row.updated_at)
    assert ImportDispatchService().claim(db, row.dispatch_uuid) is None
    assert not ImportDispatchService().mark_dispatched(db, row.dispatch_uuid)
    db.commit()
    assert (row.status, row.attempt_count, row.completed_at, row.updated_at) == before
    assert ImportDispatchService().recover_and_list_due(db) == []


@pytest.mark.parametrize(
    "mutation",
    ["start", "binding", "progress", "step", "artifacts", "success", "failure", "complete"],
)
def test_only_current_execution_lease_can_mutate_job(setup_delivery, mutation):
    db, _, job, row = setup_delivery
    first = claim(db, row)
    second = takeover(db, row)
    assert second.attempt == first.attempt + 1 and second.token != first.token
    worker = ImportExecutionRecorder()
    actions = {
        "start": lambda: worker.start_execution(db, first),
        "binding": lambda: execution_manifest.bind_import_job_execution_manifest(db, first),
        "progress": lambda: worker.record_progress(db, first, 99),
        "step": lambda: worker.upsert_step(db, first, "ocr", "RUNNING"),
        "artifacts": lambda: worker.replace_artifacts(
            db, first, ImportArtifactKind.REVIEW_MUSICXML, []
        ),
        "success": lambda: worker.finalize_success(db, first),
        "failure": lambda: worker.finalize_failure(
            db,
            first,
            failure=DurableFailure(
                "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
            ),
        ),
        "complete": lambda: ImportDispatchService().complete(db, first),
    }
    with pytest.raises(StaleImportDispatchAttempt):
        actions[mutation]()
    db.rollback()
    worker.start_execution(db, second)
    worker.record_progress(db, second, 25, current_step="current-ocr")
    assert job.progress == 25 and row.attempt_token == second.token
    assert db.scalar(select(ImportJobStep)) is None
    assert db.scalar(select(ImportArtifact)) is None
    assert job.execution_manifest_id is None
    assert db.scalar(select(Notification.id)) is None
    assert db.scalar(select(RealtimeChange.sequence)) is None


@pytest.mark.parametrize(
    "change",
    [
        {"job_uuid": "different-job"},
        {"token": "wrong-token"},
        {"attempt": 50},
        {"dispatch_uuid": "missing"},
    ],
)
def test_execution_start_requires_exact_delivery_job_attempt_token_without_commit(
    setup_delivery, change
):
    db, _, job, row = setup_delivery
    lease = claim(db, row)
    original = (
        job.state,
        job.processing_started_at,
        job.processing_last_heartbeat_at,
        job.progress,
    )
    commits = []

    def committed(session):
        commits.append(True)

    event.listen(db, "after_commit", committed)
    try:
        with pytest.raises(StaleImportDispatchAttempt):
            ImportExecutionRecorder().start_execution(db, replace(lease, **change))
    finally:
        event.remove(db, "after_commit", committed)
    assert commits == []
    assert (
        job.state,
        job.processing_started_at,
        job.processing_last_heartbeat_at,
        job.progress,
    ) == original


def test_written_artifact_requires_current_lease_at_transactional_adoption(
    setup_delivery, monkeypatch
):
    db, storage, job, row = setup_delivery
    first = claim(db, row)
    worker = ImportExecutionRecorder()
    worker.upsert_step(db, first, "ocr", "RUNNING")

    # A write can finish after its execution lease is lost. ObjectWriteIntent owns it.
    @contextmanager
    def worker_db():
        with Session(db.get_bind()) as own:
            yield own
            own.commit()

    monkeypatch.setattr("app.db.session.SessionLocal", worker_db)
    original = write_object(
        db, storage, key="jobs/current-result", content=b"current", content_type="application/xml"
    )
    worker.replace_artifacts(
        db,
        first,
        ImportArtifactKind.REVIEW_MUSICXML,
        [
            {
                "write_intent_uuid": original.intent_uuid,
                "write_token": original.write_token,
                "filename": "current.xml",
                "page_number": 1,
            }
        ],
    )
    artifact_id = db.scalar(select(ImportArtifact)).id
    receipt = write_object(
        db, storage, key="jobs/written-result", content=b"result", content_type="application/xml"
    )
    db.commit()
    second = takeover(db, row)
    events = list(db.scalars(select(StorageUsageEvent)))
    with pytest.raises(StaleImportDispatchAttempt):
        worker.replace_artifacts(
            db,
            first,
            ImportArtifactKind.REVIEW_MUSICXML,
            [
                {
                    "write_intent_uuid": receipt.intent_uuid,
                    "write_token": receipt.write_token,
                    "filename": "result.xml",
                    "page_number": 1,
                }
            ],
        )
    db.rollback()
    artifact = db.scalar(select(ImportArtifact))
    assert artifact.id == artifact_id and artifact.stored_object.object_key == "jobs/current-result"
    assert list(db.scalars(select(StorageUsageEvent))) == events
    intent = db.scalar(
        select(ObjectWriteIntent).where(ObjectWriteIntent.intent_uuid == receipt.intent_uuid)
    )
    assert intent.status == "WRITTEN" and storage.exists(intent.object_key)
    assert (
        db.scalar(select(StoredObject).where(StoredObject.object_key == intent.object_key)) is None
    )
    assert row.attempt_token == second.token and job.state == ImportJobState.QUEUED
    assert drain_write_cleanup(db, storage)[0]["status"] == "cleaned"
    assert not storage.exists(intent.object_key)
    assert storage.exists("jobs/current-result")


def test_domain_pipeline_failure_completes_current_delivery(setup_delivery):
    db, _, job, row = setup_delivery
    lease = claim(db, row)
    worker = ImportExecutionRecorder()
    worker.finalize_failure(
        db,
        lease,
        failure=DurableFailure(
            "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
        ),
    )
    ImportDispatchService().complete(db, lease)
    db.commit()
    assert job.state == ImportJobState.FAILED and job.failure_code
    assert row.status == ImportDispatchStatus.COMPLETED
    assert row.failure_detail is None and row.failure_code is None
    assert ImportDispatchService().recover_and_list_due(db) == []


def test_trace_context_belongs_to_dispatch(setup_delivery):
    db, _, job, row = setup_delivery
    context = import_dispatch_trace_context(db, row.dispatch_uuid)
    assert context.traceparent == row.traceparent
    assert import_dispatch_trace_context(db, job.job_uuid).traceparent is None


def test_submission_atomically_creates_one_delivery_and_upload_links(setup_delivery, monkeypatch):
    db, _, _, _ = setup_delivery

    service = ImportJobSubmissionService()
    monkeypatch.setattr(
        "app.modules.import_jobs.submission_service.get_request_id", lambda: "submission-request"
    )
    monkeypatch.setattr(
        "app.modules.import_jobs.submission_service.get_async_trace_context",
        lambda: ("00-0123456789abcdef0123456789abcdef-0123456789abcdef-01", "vendor=import"),
    )
    request = SimpleNamespace(
        upload_ids=["original-upload"],
        idempotency_key="submission",
        options={"display_title": "New"},
    )
    user = db.get(User, 1)
    first = service.submit(db, user, request)
    replay = service.submit(db, user, request)
    assert first["job_id"] == replay["job_id"]
    rows = list(db.scalars(select(ImportJob).where(ImportJob.idempotency_key == "submission")))
    assert len(rows) == 1 and rows[0].state == ImportJobState.QUEUED
    deliveries = list(db.scalars(select(ImportDispatch).where(ImportDispatch.job_id == rows[0].id)))
    assert len(deliveries) == 1 and deliveries[0].status == ImportDispatchStatus.PENDING
    assert deliveries[0].originating_request_id == "submission-request"
    assert deliveries[0].traceparent == "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"
    assert deliveries[0].tracestate == "vendor=import"
    assert (
        len(list(db.scalars(select(ImportJobUpload).where(ImportJobUpload.job_id == rows[0].id))))
        == 1
    )
    with pytest.raises(ResourceNotFoundException):
        service.submit(
            db,
            user,
            SimpleNamespace(
                upload_ids=["original-upload", "missing"],
                options=None,
                idempotency_key="aborted-import",
            ),
        )
    assert db.scalar(select(ImportJob).where(ImportJob.idempotency_key == "aborted-import")) is None
    assert len(list(db.scalars(select(ImportDispatch)))) == 2


@pytest.mark.parametrize("path", ["progress", "step", "tracker", "complete"])
def test_pipeline_telemetry_never_swallows_lease_loss(monkeypatch, path):
    from app.modules.import_jobs.dispatch_service import ImportExecutionLease
    from app.modules.import_jobs.pipeline import context as module

    lease = ImportExecutionLease(dispatch_uuid="delivery", job_uuid="job", attempt=1, token="token")
    ctx = JobContext(lease=lease, db=Mock(), celery_task=Mock(), image_paths=[])
    stale = Mock(side_effect=StaleImportDispatchAttempt("lost"))
    if path == "progress":
        monkeypatch.setattr(module.import_execution_recorder, "record_progress", stale)

        def action():
            ctx.progress("ocr", 20)
    elif path == "step":
        monkeypatch.setattr(module.import_execution_recorder, "upsert_step", stale)

        def action():
            ctx._upsert("ocr", status="running")
    elif path == "tracker":
        tracker = StepTracker("job", stale, {"ocr": 1})

        def action():
            tracker.on_progress("ocr")
    else:
        ctx._tracker = Mock()
        ctx._tracker.complete_last = stale
        action = ctx.complete
    with pytest.raises(StaleImportDispatchAttempt):
        action()


@pytest.mark.parametrize("outcome", ["success", "failure"])
def test_worker_completes_delivery_after_durable_domain_outcome(
    setup_delivery, monkeypatch, outcome
):
    from app.worker.execution import import_job as executor

    db, _, job, row = setup_delivery

    @contextmanager
    def worker_db():
        try:
            yield db
            db.commit()
        except Exception:
            db.rollback()
            raise

    worker = ImportExecutionRecorder()

    def run(task, lease, keys):
        assert lease.dispatch_uuid == row.dispatch_uuid and lease.job_uuid == job.job_uuid
        worker.start_execution(db, lease)
        if outcome == "failure":
            worker.finalize_failure(
                db,
                lease,
                failure=DurableFailure(
                    "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
                ),
            )
            raise RuntimeError("pipeline rejected input")
        worker.record_progress(db, lease, 0)
        physical = StoredObject(
            object_key="review.xml", byte_size=3, content_type="application/xml", sha256="a" * 64
        )
        db.add(
            ImportArtifact(
                job_id=job.id,
                kind=ImportArtifactKind.REVIEW_MUSICXML,
                filename="review.xml",
                stored_object=physical,
            )
        )
        db.commit()
        worker.finalize_success(db, lease)
        return {"success": True, "job_id": job.job_uuid}

    monkeypatch.setattr(executor, "SessionLocal", worker_db)
    monkeypatch.setattr(executor.import_pipeline_runner, "run_pipeline", run)
    task = Mock()
    task.request.id = "celery-task"
    if outcome == "failure":
        with pytest.raises(RuntimeError, match="pipeline rejected input"):
            executor.execute_import_dispatch_task(task, row.dispatch_uuid)
        assert job.state == ImportJobState.FAILED
    else:
        assert (
            executor.execute_import_dispatch_task(task, row.dispatch_uuid)["job_id"] == job.job_uuid
        )
        assert job.state == ImportJobState.READY_FOR_REVIEW
    assert row.status == ImportDispatchStatus.COMPLETED and row.attempt_token is None
    assert ImportDispatchService().recover_and_list_due(db) == []


def test_final_attempt_domain_failure_completes_delivery_and_preserves_terminal_timestamps(
    setup_delivery,
):
    from app.modules.ops.query_service import OpsAsyncOperationQueryService
    from app.modules.ops.schemas import AsyncOperationKind

    db, _, job, row = setup_delivery
    row.attempt_count = dispatch_module.settings.IMPORT_DISPATCH_MAX_ATTEMPTS - 1
    db.add(row)
    db.commit()
    lease = claim(db, row)
    assert lease.attempt == dispatch_module.settings.IMPORT_DISPATCH_MAX_ATTEMPTS
    ImportExecutionRecorder().finalize_failure(
        db,
        lease,
        failure=DurableFailure(
            "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
        ),
    )
    assert (
        OpsAsyncOperationQueryService()
        .get_operation(db, kind=AsyncOperationKind.IMPORT, operation_id=row.dispatch_uuid)
        .status.value
        == "failed"
    )
    ImportDispatchService().complete(db, lease)
    db.commit()
    projected = OpsAsyncOperationQueryService().get_operation(
        db, kind=AsyncOperationKind.IMPORT, operation_id=row.dispatch_uuid
    )
    assert projected.status.value == "failed"
    assert projected.failure.code == job.failure_code
    assert row.status == ImportDispatchStatus.COMPLETED and row.completed_at is not None
    before = (row.status, row.attempt_count, row.completed_at, row.updated_at)
    assert not ImportDispatchService().mark_dispatched(db, row.dispatch_uuid)
    assert ImportDispatchService().claim(db, row.dispatch_uuid) is None
    db.commit()
    assert (row.status, row.attempt_count, row.completed_at, row.updated_at) == before


def test_started_execution_crash_before_progress_recovers_to_queued(setup_delivery):
    db, _, job, row = setup_delivery
    lease = claim(db, row)
    ImportExecutionRecorder().start_execution(db, lease)
    db.refresh(job)
    assert row.status == ImportDispatchStatus.PROCESSING
    assert job.state == ImportJobState.PROCESSING and job.processing_started_at is not None
    assert job.processing_last_heartbeat_at is job.current_step is None and job.progress == 0
    created_at = job.created_at
    expire(db, row)
    assert ImportDispatchService().recover_and_list_due(db) == [row.dispatch_uuid]
    db.commit()
    db.refresh(job)
    assert job.state == ImportJobState.QUEUED and job.progress == 0
    assert (
        job.processing_started_at
        is job.processing_last_heartbeat_at
        is job.processing_finished_at
        is job.current_step
        is None
    )
    assert job.created_at == created_at


def test_materialization_failure_preserves_committed_start_without_a_progress_heartbeat(
    setup_delivery, monkeypatch, tmp_path
):
    from sqlalchemy.orm import sessionmaker
    from app.modules.import_jobs import pipeline_runner
    from app.modules.storage_objects.reads import StoredObjectIntegrityError

    db, storage, job, row = setup_delivery
    payload = ImportDispatchService().claim(db, row.dispatch_uuid)
    db.commit()
    engine = db.get_bind()
    job_uuid = job.job_uuid
    runner = pipeline_runner.ImportPipelineRunner(storage=storage)
    resolve_inputs = runner._resolve_input_paths
    observed_start = []

    def materialize(inputs):
        # A separate connection must observe the committed boundary before actual GET.
        with Session(engine) as observer:
            current = observer.scalar(select(ImportJob).where(ImportJob.job_uuid == job_uuid))
            assert current.state == ImportJobState.PROCESSING
            assert current.processing_started_at is not None
            assert current.processing_last_heartbeat_at is current.current_step is None
            assert current.progress == 0
            observed_start.append(current.processing_started_at)
        return resolve_inputs(inputs)

    monkeypatch.setattr(pipeline_runner, "SessionLocal", sessionmaker(bind=engine))
    monkeypatch.setattr(pipeline_runner, "object_work_path", lambda _: str(tmp_path / "input.png"))
    monkeypatch.setattr(runner, "_resolve_input_paths", materialize)
    with pytest.raises(StoredObjectIntegrityError):
        runner.run_pipeline(Mock(), payload.lease, payload.inputs)
    db.refresh(job)
    assert len(observed_start) == 1
    assert job.state == ImportJobState.FAILED
    assert job.processing_started_at == observed_start[0]
    assert job.processing_last_heartbeat_at is None
    assert job.processing_finished_at >= job.processing_started_at
    assert job.failure_code == "import_pipeline_failed"
    assert job.failure_stage == "pipeline" and job.failure_classification == "system_error"
