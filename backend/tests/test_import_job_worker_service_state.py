from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.db.models.import_job import ImportJobState, ImportJobStepStatus
from app.modules.import_jobs.worker_service import SyncImportJobService
from app.shared.constants import ErrorCode


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
        dispatch_attempt_count=2,
        requested_options={"title": "Imported score"},
        internal_error_code="old-code",
        internal_error_stage="old-stage",
        internal_error_class="system_error",
        internal_error_retryable=False,
    )


def _service_with_job(job: object | None) -> tuple[SyncImportJobService, Mock, Mock]:
    repository = Mock()
    repository.get_by_uuid.return_value = job
    notifications = Mock()
    return (
        SyncImportJobService(
            repository=repository,
            notification_service=notifications,
        ),
        repository,
        notifications,
    )


def _database() -> Mock:
    database = Mock()
    database.execute.return_value.scalar_one_or_none.return_value = None
    return database


def test_update_progress_records_state_and_preserves_existing_started_time() -> None:
    job = _job()
    service, _repository, _notifications = _service_with_job(job)
    database = _database()
    started_at = datetime(2026, 8, 9, tzinfo=timezone.utc)

    service.update_progress(
        database,
        "job-1",
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
    database.expire_all.assert_called_once()
    assert database.commit.call_count == 2

    service.update_progress(database, "job-1", "RUNNING", 70, started_at=started_at)

    assert job.progress == 70
    assert job.started_at == started_at


def test_update_progress_ignores_a_job_that_no_longer_exists() -> None:
    service, _repository, _notifications = _service_with_job(None)
    database = _database()

    service.update_progress(database, "missing-job", "RUNNING", 50)

    database.expire_all.assert_called_once()
    database.commit.assert_called_once()


def test_session_reset_rolls_back_after_a_commit_error() -> None:
    database = _database()
    database.commit.side_effect = RuntimeError("database connection lost")

    SyncImportJobService._reset_session(database)

    database.expire_all.assert_called_once()
    database.rollback.assert_called_once()


def test_finalize_success_marks_job_ready_and_notifies_owner() -> None:
    job = _job()
    service, _repository, notifications = _service_with_job(job)
    database = _database()

    service.finalize_success(database, "job-1")

    assert job.state == ImportJobState.PENDING_REVIEW
    assert job.progress == 100
    assert job.finished_at is not None
    assert job.internal_error_code is None
    assert job.internal_error_stage is None
    assert job.internal_error_class is None
    assert job.internal_error_retryable is None
    notifications.notify_import_completed_best_effort.assert_called_once_with(
        database,
        job_uuid="job-1",
        recipient_user_id=7,
        title="Imported score",
    )


def test_finalize_failure_records_diagnostic_and_notifies_owner() -> None:
    job = _job()
    service, _repository, notifications = _service_with_job(job)
    database = _database()

    service.finalize_failure(
        database,
        "job-1",
        error="worker timeout while processing image",
        error_type="TimeoutError",
        code=ErrorCode.TASK_TIMEOUT,
    )

    assert job.state == ImportJobState.FAILURE
    assert job.progress == 0
    assert job.error == "worker timeout while processing image"
    assert job.error_type == "TimeoutError"
    assert job.code == ErrorCode.TASK_TIMEOUT
    assert job.internal_error_class == "transient"
    assert job.internal_error_retryable is True
    notifications.notify_import_failed_best_effort.assert_called_once_with(
        database,
        job_uuid="job-1",
        recipient_user_id=7,
    )


def test_terminal_updates_ignore_jobs_that_no_longer_exist() -> None:
    service, _repository, notifications = _service_with_job(None)
    database = _database()

    service.finalize_success(database, "missing-job")
    service.finalize_failure(
        database,
        "missing-job",
        error="worker timeout",
        error_type="TimeoutError",
    )

    assert database.commit.call_count == 2
    notifications.notify_import_completed_best_effort.assert_not_called()
    notifications.notify_import_failed_best_effort.assert_not_called()


def test_upsert_step_creates_and_updates_a_named_step() -> None:
    job = _job()
    service, repository, _notifications = _service_with_job(job)
    database = _database()
    repository.get_step.return_value = None

    created = service.upsert_step(
        database,
        "job-1",
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
        "job-1",
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
    service, _repository, _notifications = _service_with_job(None)

    with pytest.raises(ValueError, match="Job missing-job not found"):
        service.upsert_step(_database(), "missing-job", "ocr", "RUNNING")
