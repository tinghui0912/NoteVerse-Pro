from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from celery.exceptions import SoftTimeLimitExceeded

from app.core.exceptions import TimeoutException
from app.modules.import_jobs.execution_service import ImportJobExecutionService
from app.shared.constants import ErrorCode


def test_soft_time_limit_maps_to_task_timeout() -> None:
    assert (
        ImportJobExecutionService.get_error_code(SoftTimeLimitExceeded())
        == ErrorCode.TASK_TIMEOUT
    )


def test_pipeline_timeout_maps_to_task_timeout() -> None:
    assert (
        ImportJobExecutionService.get_error_code(TimeoutException())
        == ErrorCode.TASK_TIMEOUT
    )


def test_pipeline_failure_is_persisted_and_reraised() -> None:
    service = ImportJobExecutionService(storage=Mock())
    service.storage.local_path.return_value = "/work/cache/score.png"
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
    databases = iter((first_db, failure_db))

    @contextmanager
    def database_scope():
        yield next(databases)

    with (
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
        service.run_pipeline(task, "job-id", ["upload-id"])

    finalize_failure.assert_called_once_with(
        failure_db,
        "job-id",
        error=ErrorCode.TASK_TIMEOUT,
        error_type="TimeoutException",
        code=ErrorCode.TASK_TIMEOUT,
    )
