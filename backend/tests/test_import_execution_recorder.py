from app.modules.durable_work.failure import DurableFailure, DurableFailureClass
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock
from app.modules.import_jobs.dispatch_service import (
    ImportExecutionLease,
    StaleImportDispatchAttempt,
)
from app.modules.import_jobs import execution_recorder

import pytest

from app.db.models.import_job import ImportJobState, ImportJobStepStatus
from app.modules.import_jobs.execution_recorder import ImportExecutionRecorder


LEASE = ImportExecutionLease(dispatch_uuid="dispatch-1", job_uuid="job-1", attempt=2, token="token")


@pytest.fixture(autouse=True)
def fence(monkeypatch):
    guard = Mock(side_effect=StaleImportDispatchAttempt("stale"))
    monkeypatch.setattr(execution_recorder, "require_current_attempt", guard)
    monkeypatch.setattr(execution_recorder, "admit_import_processing_outcome", Mock())
    monkeypatch.setattr(execution_recorder, "admit_review_thumbnail_render", Mock())
    return guard


def _job(*, state: ImportJobState = ImportJobState.PROCESSING) -> SimpleNamespace:
    return SimpleNamespace(
        id=17,
        job_uuid="job-1",
        user_id=7,
        state=state,
        progress=10,
        current_step="queued",
        processing_started_at=datetime(2026, 8, 9, tzinfo=timezone.utc),
        processing_last_heartbeat_at=None,
        processing_finished_at=None,
        confirmed_at=None,
        score_id=None,
        updated_at=None,
        requested_options={"display_title": "Imported score"},
        failure_code="import_pipeline_failed" if state == ImportJobState.FAILED else None,
        failure_stage="pipeline" if state == ImportJobState.FAILED else None,
        failure_classification="system_error" if state == ImportJobState.FAILED else None,
        failure_retryable=False if state == ImportJobState.FAILED else None,
        failure_detail=None,
    )


def _service_with_job(job: object | None) -> tuple[ImportExecutionRecorder, Mock, Mock]:
    if job is not None:
        execution_recorder.require_current_attempt.side_effect = None
        execution_recorder.require_current_attempt.return_value = job
    repository = Mock()
    repository.get_by_uuid.return_value = job
    admission = execution_recorder.admit_import_processing_outcome
    return (
        ImportExecutionRecorder(
            repository=repository,
        ),
        repository,
        admission,
    )


def _database() -> Mock:
    database = Mock()
    database.execute.return_value.scalar_one_or_none.return_value = SimpleNamespace(
        stored_object=SimpleNamespace(sha256="a" * 64)
    )
    return database


def test_record_progress_records_state_and_preserves_existing_started_time() -> None:
    job = _job()
    service, _repository, _admission = _service_with_job(job)
    database = _database()
    started_at = datetime(2026, 8, 9, tzinfo=timezone.utc)

    service.record_progress(
        database,
        LEASE,
        60,
        current_step="ocr",
    )

    assert job.state == ImportJobState.PROCESSING
    assert job.progress == 60
    assert job.current_step == "ocr"
    assert job.processing_started_at == started_at
    assert job.processing_last_heartbeat_at is not None
    assert (
        job.failure_code
        is job.failure_stage
        is job.failure_classification
        is job.failure_retryable
        is job.failure_detail
        is None
    )
    assert database.commit.call_count == 1

    service.record_progress(database, LEASE, 70)

    assert job.progress == 70
    assert job.processing_started_at == started_at


def test_record_progress_rejects_stale_execution() -> None:
    service, _, _ = _service_with_job(None)
    database = _database()
    with pytest.raises(StaleImportDispatchAttempt):
        service.record_progress(database, LEASE, 50)
    database.commit.assert_not_called()


def test_finalize_success_marks_job_ready_and_admits_processing_consequences() -> None:
    job = _job()
    service, _repository, admission = _service_with_job(job)
    database = _database()

    service.finalize_success(database, LEASE)

    assert job.state == ImportJobState.READY_FOR_REVIEW
    assert job.progress == 100
    assert job.processing_finished_at is not None
    assert job.failure_code is None
    assert job.failure_stage is None
    assert job.failure_classification is None
    assert job.failure_retryable is None
    assert job.failure_detail is None
    admission.assert_called_once_with(database, job, created_at=job.processing_finished_at)
    database.commit.assert_called_once()


def test_finalize_failure_records_bounded_internal_evidence_and_terminal_consequences() -> None:
    job = _job()
    service, _repository, admission = _service_with_job(job)
    database = _database()

    service.finalize_failure(
        database,
        LEASE,
        failure=DurableFailure(
            "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
        ),
        detail="private provider evidence " * 300,
    )

    assert job.state == ImportJobState.FAILED
    assert job.progress == 0
    assert job.failure_detail == ("private provider evidence " * 300)[:4000]
    assert job.failure_classification == "system_error"
    assert job.failure_retryable is False
    admission.assert_called_once_with(database, job, created_at=job.processing_finished_at)
    database.commit.assert_called_once()


def test_processing_outcome_updates_reject_stale_execution() -> None:
    service, _, admission = _service_with_job(None)
    database = _database()
    with pytest.raises(StaleImportDispatchAttempt):
        service.finalize_success(database, LEASE)
    with pytest.raises(StaleImportDispatchAttempt):
        service.finalize_failure(
            database,
            LEASE,
            failure=DurableFailure(
                "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
            ),
        )
    database.commit.assert_not_called()
    admission.assert_not_called()


def test_upsert_step_creates_and_updates_a_named_step() -> None:
    job = _job()
    service, repository, _admission = _service_with_job(job)
    database = _database()
    repository.get_step.return_value = None

    created = service.upsert_step(
        database,
        LEASE,
        "ocr",
        "running",
        step_order=2,
    )

    assert created.job_id == 17
    assert created.name == "ocr"
    assert created.status == ImportJobStepStatus.RUNNING
    assert created.step_order == 2
    database.add.assert_called_once_with(created)

    existing = SimpleNamespace(
        status=ImportJobStepStatus.RUNNING,
        start_time=created.start_time,
        end_time=None,
        step_order=2,
    )
    repository.get_step.return_value = existing
    completed_at = datetime(2026, 8, 9, tzinfo=timezone.utc)

    updated = service.upsert_step(
        database,
        LEASE,
        "ocr",
        ImportJobStepStatus.COMPLETED,
        end_time=completed_at,
        step_order=3,
    )

    assert updated is existing
    assert existing.status == ImportJobStepStatus.COMPLETED
    assert existing.end_time == completed_at
    assert existing.step_order == 3


def test_upsert_step_rejects_missing_jobs() -> None:
    service, _repository, _admission = _service_with_job(None)

    with pytest.raises(StaleImportDispatchAttempt):
        service.upsert_step(_database(), LEASE, "ocr", "RUNNING")
