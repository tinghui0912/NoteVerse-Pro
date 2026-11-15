from app.modules.durable_work.failure import DurableFailure, DurableFailureClass
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock
from app.modules.import_jobs.dispatch_service import (
    ImportExecutionLease,
    StaleImportDispatchAttempt,
)
from app.modules.import_jobs import worker_service

import pytest

from app.db.models.import_job import ImportJobState, ImportJobStepStatus
from app.modules.import_jobs.worker_service import ImportJobExecutionService
from app.shared.constants import ErrorCode


LEASE = ImportExecutionLease(dispatch_uuid="dispatch-1", job_uuid="job-1", attempt=2, token="token")


@pytest.fixture(autouse=True)
def fence(monkeypatch):
    guard = Mock(side_effect=StaleImportDispatchAttempt("stale"))
    monkeypatch.setattr(worker_service, "require_current_attempt", guard)
    monkeypatch.setattr(worker_service, "admit_import_outcome", Mock())
    return guard


def _job(*, state: ImportJobState = ImportJobState.RUNNING) -> SimpleNamespace:
    return SimpleNamespace(
        id=17,
        job_uuid="job-1",
        user_id=7,
        state=state,
        progress=10,
        current_step="queued",
        code=None,
        error=None,
        error_type=None,
        started_at=None,
        last_heartbeat_at=None,
        finished_at=None,
        updated_at=None,
        requested_options={"title": "Imported score"},
        internal_error_code="old-code",
        internal_error_stage="old-stage",
        internal_error_class="system_error",
        internal_error_retryable=False,
    )


def _service_with_job(job: object | None) -> tuple[ImportJobExecutionService, Mock, Mock]:
    if job is not None:
        worker_service.require_current_attempt.side_effect = None
        worker_service.require_current_attempt.return_value = job
    repository = Mock()
    repository.get_by_uuid.return_value = job
    admission = worker_service.admit_import_outcome
    return (
        ImportJobExecutionService(
            repository=repository,
        ),
        repository,
        admission,
    )


def _database() -> Mock:
    database = Mock()
    database.execute.return_value.scalar_one_or_none.return_value = None
    return database


def test_update_progress_records_state_and_preserves_existing_started_time() -> None:
    job = _job()
    service, _repository, _admission = _service_with_job(job)
    database = _database()
    started_at = datetime(2026, 8, 9, tzinfo=timezone.utc)

    service.update_progress(
        database,
        LEASE,
        ImportJobState.RUNNING,
        60,
        current_step="ocr",
        code="processing",
        started_at=started_at,
    )

    assert job.state == ImportJobState.RUNNING
    assert job.progress == 60
    assert job.current_step == "ocr"
    assert job.code == "processing"
    assert job.started_at == started_at
    assert job.last_heartbeat_at is not None
    assert database.commit.call_count == 1

    service.update_progress(database, LEASE, "RUNNING", 70, started_at=started_at)

    assert job.progress == 70
    assert job.started_at == started_at


def test_update_progress_rejects_stale_execution() -> None:
    service, _, _ = _service_with_job(None)
    database = _database()
    with pytest.raises(StaleImportDispatchAttempt):
        service.update_progress(database, LEASE, "RUNNING", 50)
    database.commit.assert_not_called()


def test_finalize_success_marks_job_ready_and_admits_terminal_consequences() -> None:
    job = _job()
    service, _repository, admission = _service_with_job(job)
    database = _database()

    service.finalize_success(database, LEASE)

    assert job.state == ImportJobState.PENDING_REVIEW
    assert job.progress == 100
    assert job.finished_at is not None
    assert job.internal_error_code is None
    assert job.internal_error_stage is None
    assert job.internal_error_class is None
    assert job.internal_error_retryable is None
    admission.assert_called_once_with(database, job, created_at=job.finished_at)
    database.commit.assert_called_once()


def test_finalize_failure_records_bounded_internal_evidence_and_terminal_consequences() -> None:
    job = _job()
    service, _repository, admission = _service_with_job(job)
    database = _database()

    service.finalize_failure(
        database,
        LEASE,
        error="worker timeout while processing image",
        error_type="TimeoutError",
        code=ErrorCode.TASK_TIMEOUT,
        failure=DurableFailure(
            "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
        ),
        detail="private provider evidence " * 300,
    )

    assert job.state == ImportJobState.FAILURE
    assert job.progress == 0
    assert job.error == "worker timeout while processing image"
    assert job.error_type == "TimeoutError"
    assert job.code == ErrorCode.TASK_TIMEOUT
    assert job.internal_error_detail == ("private provider evidence " * 300)[:4000]
    assert job.internal_error_class == "system_error"
    assert job.internal_error_retryable is False
    admission.assert_called_once_with(database, job, created_at=job.finished_at)
    database.commit.assert_called_once()


def test_terminal_updates_reject_stale_execution() -> None:
    service, _, admission = _service_with_job(None)
    database = _database()
    with pytest.raises(StaleImportDispatchAttempt):
        service.finalize_success(database, LEASE)
    with pytest.raises(StaleImportDispatchAttempt):
        service.finalize_failure(
            database,
            LEASE,
            error="timeout",
            error_type="TimeoutError",
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
