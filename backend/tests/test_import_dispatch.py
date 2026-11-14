"""Import delivery, domain outcomes and current-attempt mutation authority."""

from contextlib import contextmanager
from dataclasses import replace
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import select
from sqlmodel import Session

from app.core.exceptions import ResourceNotFoundException
from app.db.models import (
    ImportDispatch,
    DomainEvent,
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
    require_current_attempt,
)
from app.modules.import_jobs.worker_service import SyncImportJobService
from app.modules.import_jobs.submission_service import ImportJobSubmissionService
from app.modules.storage_objects.writes import write_object
from app.modules.import_jobs.pipeline.context import JobContext
from app.modules.import_jobs.pipeline.step_tracker import StepTracker
from app.task_queue.tracing import import_dispatch_trace_context
from app.utils.timezone import utc_now_naive
from tests.test_score_revision_services import score_service_session as score_service_session
from tests.support.write_cleanup import drain_write_cleanup


@pytest.fixture
def setup_delivery(score_service_session):
    db, storage = score_service_session
    job = ImportJob(
        job_uuid="import-domain",
        user_id=1,
        state=ImportJobState.PENDING,
        requested_options={"title": "Current import"},
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
    row.started_at = utc_now_naive() - timedelta(
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
    assert payload.options == job.requested_options
    assert payload.storage_keys == ["upload/original.png"]
    assert row.attempt_token == payload.lease.token
    job.state = ImportJobState.PENDING_REVIEW
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
    job.internal_error_code = "domain-diagnostic"
    db.add(job)
    db.commit()
    service = ImportDispatchService()
    assert service.mark_dispatched(db, row.dispatch_uuid)
    db.commit()
    service.release_dispatch(db, row.dispatch_uuid, "broker unavailable")
    db.commit()
    assert row.status == ImportDispatchStatus.PENDING
    assert row.attempt_count == 0 and row.dispatched_at is None
    assert row.last_error == "broker unavailable" and row.internal_error_code
    assert job.state == ImportJobState.PENDING
    assert job.internal_error_code == "domain-diagnostic"


def test_expired_dispatch_preserves_domain_progress_and_steps(setup_delivery):
    db, _, job, row = setup_delivery
    service = ImportDispatchService()
    assert service.mark_dispatched(db, row.dispatch_uuid)
    row.dispatched_at = utc_now_naive() - timedelta(
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
    job.state, job.progress, job.current_step = ImportJobState.RUNNING, 73, "ocr"
    job.started_at = job.last_heartbeat_at = utc_now_naive()
    job.code = job.error = job.error_type = "attempt-local"
    job.internal_error_code = "attempt-local"
    db.add(ImportJobStep(job_id=job.id, step_order=1, name="ocr", status="RUNNING"))
    db.add(job)
    db.commit()
    expire(db, row)
    assert ImportDispatchService().recover_and_list_due(db) == [row.dispatch_uuid]
    assert row.status == ImportDispatchStatus.FAILED and row.attempt_count == lease.attempt
    assert row.attempt_token is None and row.next_attempt_at <= utc_now_naive()
    assert job.state == ImportJobState.PENDING and job.progress == 0
    assert job.current_step is job.started_at is job.last_heartbeat_at is job.finished_at is None
    assert job.code is job.error is job.error_type is job.internal_error_code is None
    assert job.execution_manifest_id == manifest.id
    assert job.requested_options == {"title": "Current import"}
    assert db.scalar(select(ImportJobUpload)).job_id == job.id
    assert db.scalar(select(ImportJobStep)) is None


@pytest.mark.parametrize(
    "state", [ImportJobState.PENDING_REVIEW, ImportJobState.FAILURE, ImportJobState.CONFIRMED]
)
def test_terminal_domain_outcome_reconciles_expired_delivery_without_execution(
    setup_delivery, state
):
    db, _, job, row = setup_delivery
    claim(db, row)
    job.state, job.progress = state, 100
    job.error = "durable-domain-result"
    job.internal_error_code = "domain-result"
    db.add(ImportJobStep(job_id=job.id, step_order=1, name="ocr", status="COMPLETED"))
    db.add(job)
    db.commit()
    expire(db, row)
    assert ImportDispatchService().recover_and_list_due(db) == []
    assert row.status == ImportDispatchStatus.COMPLETED and row.attempt_token is None
    assert job.state == state and job.progress == 100
    assert job.error == "durable-domain-result" and job.internal_error_code == "domain-result"
    assert db.scalar(select(ImportJobStep)).status.value == "COMPLETED"
    assert ImportDispatchService().claim(db, row.dispatch_uuid) is None


def test_exhausted_processing_has_distinct_delivery_and_domain_outcomes(setup_delivery):
    db, _, job, row = setup_delivery
    claim(db, row)
    row.attempt_count = dispatch_module.settings.IMPORT_DISPATCH_MAX_ATTEMPTS
    job.state = ImportJobState.RUNNING
    db.add_all([row, job])
    db.commit()
    expire(db, row)
    assert ImportDispatchService().recover_and_list_due(db) == []
    assert row.status == ImportDispatchStatus.FAILED and row.attempt_token is None
    assert row.internal_error_code and job.internal_error_code
    assert job.state == ImportJobState.FAILURE and job.finished_at
    assert job.error_type == "ImportDispatchFailure"
    assert db.scalar(select(DomainEvent.event_type)) == "import.job.failed"
    from app.modules.ops.operation_projection import read_import_operation

    projected = read_import_operation(job, row)
    assert projected.status.value == "exhausted"
    assert projected.diagnostic.code == row.internal_error_code
    before = (row.status, row.attempt_count, row.completed_at, row.updated_at)
    assert ImportDispatchService().claim(db, row.dispatch_uuid) is None
    assert not ImportDispatchService().mark_dispatched(db, row.dispatch_uuid)
    db.commit()
    assert (row.status, row.attempt_count, row.completed_at, row.updated_at) == before
    assert ImportDispatchService().recover_and_list_due(db) == []


@pytest.mark.parametrize(
    "mutation", ["binding", "progress", "step", "artifacts", "success", "failure", "complete"]
)
def test_only_current_execution_lease_can_mutate_job(setup_delivery, mutation):
    db, _, job, row = setup_delivery
    first = claim(db, row)
    second = takeover(db, row)
    assert second.attempt == first.attempt + 1 and second.token != first.token
    worker = SyncImportJobService()
    actions = {
        "binding": lambda: execution_manifest.bind_import_job_execution_manifest(db, first),
        "progress": lambda: worker.update_progress(db, first, "RUNNING", 99),
        "step": lambda: worker.upsert_step(db, first, "ocr", "RUNNING"),
        "artifacts": lambda: worker.replace_artifacts(db, first, "review_musicxml", []),
        "success": lambda: worker.finalize_success(db, first),
        "failure": lambda: worker.finalize_failure(db, first, "stale", "Stale"),
        "complete": lambda: ImportDispatchService().complete(db, first),
    }
    with pytest.raises(StaleImportDispatchAttempt):
        actions[mutation]()
    db.rollback()
    worker.update_progress(db, second, "RUNNING", 25, current_step="current-ocr")
    assert job.progress == 25 and row.attempt_token == second.token
    assert db.scalar(select(ImportJobStep)) is None
    assert db.scalar(select(ImportArtifact)) is None
    assert job.execution_manifest_id is None
    assert db.scalar(select(DomainEvent.id)) is None


@pytest.mark.parametrize(
    "change",
    [
        {"job_uuid": "different-job"},
        {"token": "wrong-token"},
        {"attempt": 50},
        {"dispatch_uuid": "missing"},
    ],
)
def test_execution_lease_requires_exact_delivery_job_attempt_token(setup_delivery, change):
    db, _, _, row = setup_delivery
    lease = claim(db, row)
    with pytest.raises(StaleImportDispatchAttempt):
        require_current_attempt(db, replace(lease, **change))


def test_written_artifact_requires_current_lease_at_transactional_adoption(
    setup_delivery, monkeypatch
):
    db, storage, job, row = setup_delivery
    first = claim(db, row)
    worker = SyncImportJobService()
    worker.upsert_step(db, first, "ocr", "RUNNING")

    # A write can finish after its execution lease is lost. ObjectWriteIntent owns it.
    @contextmanager
    def worker_db():
        with Session(db.get_bind()) as own:
            yield own
            own.commit()

    monkeypatch.setattr("app.db.sync_session.get_worker_db", worker_db)
    original = write_object(
        db, storage, key="jobs/current-result", content=b"current", content_type="application/xml"
    )
    worker.replace_artifacts(
        db,
        first,
        "review_musicxml",
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
            "review_musicxml",
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
    assert row.attempt_token == second.token and job.state == ImportJobState.PENDING
    assert drain_write_cleanup(db, storage)[0]["status"] == "cleaned"
    assert not storage.exists(intent.object_key)
    assert storage.exists("jobs/current-result")


def test_domain_pipeline_failure_completes_current_delivery(setup_delivery):
    db, _, job, row = setup_delivery
    lease = claim(db, row)
    worker = SyncImportJobService()
    worker.finalize_failure(db, lease, error="OMR failed", error_type="PipelineError")
    ImportDispatchService().complete(db, lease)
    db.commit()
    assert job.state == ImportJobState.FAILURE and job.internal_error_code
    assert row.status == ImportDispatchStatus.COMPLETED
    assert row.last_error is None and row.internal_error_code is None
    assert ImportDispatchService().recover_and_list_due(db) == []


def test_trace_context_belongs_to_dispatch(setup_delivery):
    db, _, job, row = setup_delivery
    context = import_dispatch_trace_context(db, row.dispatch_uuid)
    assert context.traceparent == row.traceparent
    assert import_dispatch_trace_context(db, job.job_uuid).traceparent is None


@pytest.mark.asyncio
async def test_submission_atomically_creates_one_delivery_and_upload_links(
    setup_delivery, monkeypatch
):
    db, _, _, _ = setup_delivery
    from tests.test_score_revision_services import AsyncSessionAdapter

    async_db = AsyncSessionAdapter(db)
    monkeypatch.setattr(
        "app.db.sync_session.get_db_session",
        lambda: pytest.fail("HTTP path requires only AsyncSession"),
    )
    service = ImportJobSubmissionService()
    monkeypatch.setattr(
        "app.modules.import_jobs.submission_service.get_request_id", lambda: "submission-request"
    )
    monkeypatch.setattr(
        "app.modules.import_jobs.submission_service.get_async_trace_context",
        lambda: ("00-0123456789abcdef0123456789abcdef-0123456789abcdef-01", "vendor=import"),
    )
    request = SimpleNamespace(
        upload_ids=["original-upload"], idempotency_key="submission", options={"title": "New"}
    )
    user = db.get(User, 1)
    first = await service.submit(async_db, user, request)
    replay = await service.submit(async_db, user, request)
    assert first["job_id"] == replay["job_id"]
    rows = list(db.scalars(select(ImportJob).where(ImportJob.idempotency_key == "submission")))
    assert len(rows) == 1 and rows[0].state == ImportJobState.PENDING
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
        await service.submit(
            async_db,
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
        monkeypatch.setattr(module.job_service, "update_progress", stale)

        def action():
            ctx.status("RUNNING", "ocr", 20)
    elif path == "step":
        monkeypatch.setattr(module.job_service, "upsert_step", stale)

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

    worker = SyncImportJobService()

    def run(task, lease, keys, options):
        assert lease.dispatch_uuid == row.dispatch_uuid and lease.job_uuid == job.job_uuid
        if outcome == "failure":
            worker.finalize_failure(db, lease, "pipeline rejected input", "PipelineError")
            raise RuntimeError("pipeline rejected input")
        worker.finalize_success(db, lease)
        return {"success": True, "job_id": job.job_uuid}

    monkeypatch.setattr(executor, "get_worker_db", worker_db)
    monkeypatch.setattr(executor.job_execution_service, "run_pipeline", run)
    task = Mock()
    task.request.id = "celery-task"
    if outcome == "failure":
        with pytest.raises(RuntimeError, match="pipeline rejected input"):
            executor.execute_import_dispatch_task(task, row.dispatch_uuid)
        assert job.state == ImportJobState.FAILURE
    else:
        assert (
            executor.execute_import_dispatch_task(task, row.dispatch_uuid)["job_id"] == job.job_uuid
        )
        assert job.state == ImportJobState.PENDING_REVIEW
    assert row.status == ImportDispatchStatus.COMPLETED and row.attempt_token is None
    assert ImportDispatchService().recover_and_list_due(db) == []


def test_final_attempt_domain_failure_completes_delivery_and_preserves_terminal_timestamps(
    setup_delivery,
):
    from app.modules.ops.operation_projection import read_import_operation

    db, _, job, row = setup_delivery
    row.attempt_count = dispatch_module.settings.IMPORT_DISPATCH_MAX_ATTEMPTS - 1
    db.add(row)
    db.commit()
    lease = claim(db, row)
    assert lease.attempt == dispatch_module.settings.IMPORT_DISPATCH_MAX_ATTEMPTS
    SyncImportJobService().finalize_failure(db, lease, "OMR failed", "PipelineError")
    assert read_import_operation(job, row).status.value == "failed"
    ImportDispatchService().complete(db, lease)
    db.commit()
    projected = read_import_operation(job, row)
    assert projected.status.value == "failed"
    assert projected.diagnostic.code == job.internal_error_code
    assert row.status == ImportDispatchStatus.COMPLETED and row.completed_at is not None
    before = (row.status, row.attempt_count, row.completed_at, row.updated_at)
    assert not ImportDispatchService().mark_dispatched(db, row.dispatch_uuid)
    assert ImportDispatchService().claim(db, row.dispatch_uuid) is None
    db.commit()
    assert (row.status, row.attempt_count, row.completed_at, row.updated_at) == before
