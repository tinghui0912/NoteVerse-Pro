from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from celery.exceptions import SoftTimeLimitExceeded

from app.core.exceptions import TimeoutException
from app.modules.import_jobs.dispatch_service import (
    ImportExecutionLease,
    StaleImportDispatchAttempt,
)
from app.modules.import_jobs.execution_service import ImportJobExecutionService
from app.shared.constants import ErrorCode


def test_soft_time_limit_maps_to_task_timeout() -> None:
    assert (
        ImportJobExecutionService.get_error_code(SoftTimeLimitExceeded()) == ErrorCode.TASK_TIMEOUT
    )


def test_pipeline_timeout_maps_to_task_timeout() -> None:
    assert ImportJobExecutionService.get_error_code(TimeoutException()) == ErrorCode.TASK_TIMEOUT


def test_pipeline_failure_is_persisted_and_reraised() -> None:
    service = ImportJobExecutionService(storage=Mock())
    service.storage.materialize_to_local.return_value = "/work/score.png"
    task = SimpleNamespace(
        request=SimpleNamespace(id="job-123"),
        update_state=Mock(),
    )
    pipeline = Mock()
    pipeline.run.side_effect = TimeoutException()
    context = Mock()
    first_db = Mock()
    failure_db = Mock()
    databases = iter((Mock(), first_db, failure_db))
    lease = ImportExecutionLease("dispatch", "job-id", 1, "token")

    @contextmanager
    def database_scope():
        yield next(databases)

    with (
        patch("app.modules.import_jobs.execution_service.require_current_attempt"),
        patch("app.modules.import_jobs.execution_service.bind_import_job_execution_manifest"),
        patch(
            "app.modules.import_jobs.execution_service.get_worker_db",
            side_effect=database_scope,
        ),
        patch(
            "app.modules.import_jobs.execution_service.JobContext",
            return_value=context,
        ),
        patch(
            "app.modules.import_jobs.execution_service.PipelineBuilder.build",
            return_value=pipeline,
        ),
        patch(
            "app.modules.import_jobs.execution_service.sync_import_job_service.finalize_failure"
        ) as finalize_failure,
        pytest.raises(TimeoutException),
    ):
        service.run_pipeline(task, lease, ["upload-id"])

    finalize_failure.assert_called_once_with(
        failure_db,
        lease,
        error=ErrorCode.TASK_TIMEOUT,
        error_type="TimeoutException",
        code=ErrorCode.TASK_TIMEOUT,
    )


def test_stale_execution_aborts_before_materialization_without_domain_failure():
    service = ImportJobExecutionService(storage=Mock())
    lease = ImportExecutionLease("delivery", "job", 1, "token")

    @contextmanager
    def database_scope():
        yield Mock()

    with (
        patch("app.modules.import_jobs.execution_service.get_worker_db", database_scope),
        patch(
            "app.modules.import_jobs.execution_service.require_current_attempt",
            side_effect=StaleImportDispatchAttempt("lost"),
        ),
        patch(
            "app.modules.import_jobs.execution_service.sync_import_job_service.finalize_failure"
        ) as failure,
        pytest.raises(StaleImportDispatchAttempt),
    ):
        service.run_pipeline(Mock(), lease, ["original.png"])
    failure.assert_not_called()
    service.storage.materialize_to_local.assert_not_called()
