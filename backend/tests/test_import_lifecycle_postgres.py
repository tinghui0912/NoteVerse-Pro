"""Import processing outcomes, confirmation and persisted lifecycle facts agree."""

from datetime import timedelta

import pytest
from sqlalchemy import select, event
from sqlalchemy.exc import IntegrityError

from app.db.models import (
    ImportJob,
    ImportDispatch,
    ImportDispatchStatus,
    ImportArtifact,
    Notification,
    NotificationKind,
    Score,
    ImportJobStep,
)
from app.db.models.import_job import ImportJobState
from app.modules.import_jobs.lifecycle import (
    queue_import,
    begin_processing,
    mark_ready_for_review,
    mark_confirmed,
    mark_failed,
)
from app.modules.import_jobs.dispatch_service import ImportDispatchService, ImportExecutionLease
from app.modules.import_jobs.execution_recorder import ImportExecutionRecorder
from app.modules.import_jobs.service import ImportJobService
from app.modules.durable_work.failure import DurableFailure, DurableFailureClass
from app.modules.storage_objects.persistence import object_from_bytes
from app.shared.time import utc_now
from tests.test_score_revision_services import score_service_session as score_service_session

FAILURE = DurableFailure(
    "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
)


def queued(db, identity="lifecycle"):
    job = ImportJob(job_uuid=identity, user_id=1)
    now = utc_now()
    queue_import(job, now=now)
    db.add(job)
    db.flush()
    return job


def test_processing_outcome_and_confirmation_have_distinct_durable_instants(score_service_session):
    db, _ = score_service_session
    job = queued(db)
    admitted_at = job.created_at
    assert job.state == ImportJobState.QUEUED
    assert job.processing_started_at is job.processing_finished_at is job.confirmed_at is None
    dispatch = ImportDispatch(
        job_id=job.id,
        status=ImportDispatchStatus.PROCESSING,
        attempt_count=1,
        attempt_token="current",
        started_at=utc_now(),
    )
    db.add(dispatch)
    blob = object_from_bytes(
        object_key="review.xml", content=b"<score-partwise/>", content_type="application/xml"
    )
    db.add(
        ImportArtifact(
            job_id=job.id, kind="review_musicxml", filename="review.xml", stored_object=blob
        )
    )
    db.commit()
    lease = ImportExecutionLease(
        dispatch_uuid=dispatch.dispatch_uuid, job_uuid=job.job_uuid, attempt=1, token="current"
    )
    recorder = ImportExecutionRecorder()
    recorder.start_execution(db, lease)
    started_at = job.processing_started_at
    assert job.state == ImportJobState.PROCESSING and started_at >= admitted_at
    assert job.progress == 0 and job.current_step is None
    assert job.processing_last_heartbeat_at is job.processing_finished_at is None
    recorder.start_execution(db, lease)
    assert job.processing_started_at == started_at
    assert job.processing_last_heartbeat_at is None
    recorder.record_progress(db, lease, 10, current_step="recognition")
    assert job.processing_started_at == started_at
    assert job.processing_last_heartbeat_at is not None and job.processing_finished_at is None
    recorder.record_progress(db, lease, 80)
    assert job.processing_started_at == started_at
    recorder.finalize_success(db, lease)
    finished_at = job.processing_finished_at
    assert job.state == ImportJobState.READY_FOR_REVIEW and job.progress == 100
    assert finished_at >= started_at and job.confirmed_at is None and job.score_id is None
    notice = db.scalar(select(Notification).where(Notification.import_job_id == job.job_uuid))
    assert notice.kind == NotificationKind.IMPORT_READY_FOR_REVIEW
    assert notice.created_at == finished_at
    score = Score(score_uuid="confirmed-score", owner_user_id=1, display_title="Score")
    db.add(score)
    db.flush()
    mark_confirmed(job, score_id=score.id, now=finished_at + timedelta(seconds=1))
    db.commit()
    confirmed_at = job.confirmed_at
    assert job.state == ImportJobState.CONFIRMED and confirmed_at > finished_at
    mark_confirmed(job, score_id=score.id, now=confirmed_at + timedelta(seconds=1))
    db.commit()
    assert job.confirmed_at == confirmed_at
    assert job.processing_started_at == started_at and job.processing_finished_at == finished_at


def test_failure_recovery_clears_only_execution_facts(score_service_session):
    db, _ = score_service_session
    job = queued(db)
    original = (job.created_at, job.job_uuid, job.requested_options)
    begin_processing(job, now=utc_now())
    mark_failed(job, failure=FAILURE, detail="diagnostic", now=utc_now())
    db.add(ImportDispatch(job_id=job.id))
    db.add(ImportJobStep(job_id=job.id, name="recognition", status="FAILED", step_order=1))
    db.commit()
    assert job.state == ImportJobState.FAILED and job.processing_finished_at is not None
    ImportDispatchService().reset_execution(db, job, utc_now())
    db.commit()
    assert job.state == ImportJobState.QUEUED and job.progress == 0
    assert (
        job.processing_started_at
        is job.processing_last_heartbeat_at
        is job.processing_finished_at
        is job.confirmed_at
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
    assert db.scalar(select(ImportJobStep)) is None
    assert (job.created_at, job.job_uuid, job.requested_options) == original


@pytest.mark.parametrize(
    "state,changes",
    [
        (ImportJobState.PROCESSING, {"processing_started_at": None}),
        (ImportJobState.READY_FOR_REVIEW, {"processing_finished_at": None}),
        (ImportJobState.CONFIRMED, {"score_id": None}),
        (ImportJobState.CONFIRMED, {"confirmed_at": None}),
        (ImportJobState.FAILED, {"failure_code": None}),
        (ImportJobState.FAILED, {"processing_finished_at": None}),
        (
            ImportJobState.QUEUED,
            {
                "failure_code": "cause",
                "failure_stage": "pipeline",
                "failure_classification": "system_error",
                "failure_retryable": False,
            },
        ),
        (ImportJobState.QUEUED, {"processing_started_at": "now"}),
        (ImportJobState.READY_FOR_REVIEW, {"confirmed_at": "now"}),
        (ImportJobState.QUEUED, {"progress": -1}),
        (ImportJobState.QUEUED, {"progress": 101}),
    ],
)
def test_postgresql_enforces_import_lifecycle_combinations(score_service_session, state, changes):
    db, _ = score_service_session
    score = Score(score_uuid="score", owner_user_id=1, display_title="Score")
    db.add(score)
    db.commit()
    job = queued(db)
    now = utc_now()
    if state in {
        ImportJobState.PROCESSING,
        ImportJobState.READY_FOR_REVIEW,
        ImportJobState.CONFIRMED,
    }:
        begin_processing(job, now=now)
    if state in {ImportJobState.READY_FOR_REVIEW, ImportJobState.CONFIRMED}:
        mark_ready_for_review(job, now=now)
    if state == ImportJobState.CONFIRMED:
        mark_confirmed(job, score_id=score.id, now=now)
    if state == ImportJobState.FAILED:
        mark_failed(job, failure=FAILURE, detail=None, now=now)
    db.commit()
    for field, value in changes.items():
        setattr(job, field, now if value == "now" else value)
    with pytest.raises(IntegrityError):
        db.flush()
    db.rollback()


def test_confirmed_batch_status_bulk_hydrates_score_identities(score_service_session):
    db, _ = score_service_session
    jobs = []
    for index in range(5):
        job = queued(db, str(index))
        score = Score(score_uuid=f"score-{index}", owner_user_id=1, display_title="Score")
        db.add(score)
        db.flush()
        begin_processing(job, now=utc_now())
        mark_ready_for_review(job, now=utc_now())
        mark_confirmed(job, score_id=score.id, now=utc_now())
        jobs.append(job)
    db.commit()
    job_ids = [job.job_uuid for job in jobs]
    queries = []

    def observe(*args):
        queries.append(1)

    event.listen(db.bind, "before_cursor_execute", observe)
    try:
        result = ImportJobService().batch_status(db, job_ids, 1)
    finally:
        event.remove(db.bind, "before_cursor_execute", observe)
    assert len(queries) == 2
    assert [result[str(index)]["score_id"] for index in range(5)] == [
        f"score-{index}" for index in range(5)
    ]
    assert all(
        row["state"] == ImportJobState.CONFIRMED and row["public_code"] is None
        for row in result.values()
    )
