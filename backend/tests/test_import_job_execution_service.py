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
from app.modules.durable_work.failure import DurableFailure, DurableFailureClass


def test_soft_time_limit_maps_to_pipeline_timeout() -> None:
    assert ImportJobExecutionService.failure_for_exception(
        SoftTimeLimitExceeded()
    ) == DurableFailure("import_pipeline_timeout", "pipeline", DurableFailureClass.TRANSIENT, False)


def test_pipeline_timeout_has_transient_terminal_facts() -> None:
    assert ImportJobExecutionService.failure_for_exception(TimeoutException()) == DurableFailure(
        "import_pipeline_timeout", "pipeline", DurableFailureClass.TRANSIENT, False
    )


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
    lease = ImportExecutionLease(
        dispatch_uuid="dispatch", job_uuid="job-id", attempt=1, token="token"
    )

    @contextmanager
    def database_scope():
        yield next(databases)

    with (
        patch.object(
            service, "failure_for_exception", wraps=service.failure_for_exception
        ) as mapper,
        patch("app.modules.import_jobs.execution_service.require_current_attempt"),
        patch("app.modules.import_jobs.execution_service.bind_import_job_execution_manifest"),
        patch(
            "app.modules.import_jobs.execution_service.SessionLocal",
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
            "app.modules.import_jobs.execution_service.import_job_execution_service.finalize_failure"
        ) as finalize_failure,
        pytest.raises(TimeoutException),
    ):
        service.run_pipeline(task, lease, ["upload-id"])

    mapper.assert_called_once_with(pipeline.run.side_effect)
    finalize_failure.assert_called_once_with(
        failure_db,
        lease,
        failure=DurableFailure(
            "import_pipeline_timeout", "pipeline", DurableFailureClass.TRANSIENT, False
        ),
        detail=str(TimeoutException()),
    )


def test_stale_execution_aborts_before_materialization_without_domain_failure():
    service = ImportJobExecutionService(storage=Mock())
    lease = ImportExecutionLease(dispatch_uuid="delivery", job_uuid="job", attempt=1, token="token")

    @contextmanager
    def database_scope():
        yield Mock()

    with (
        patch("app.modules.import_jobs.execution_service.SessionLocal", database_scope),
        patch(
            "app.modules.import_jobs.execution_service.require_current_attempt",
            side_effect=StaleImportDispatchAttempt("lost"),
        ),
        patch(
            "app.modules.import_jobs.execution_service.import_job_execution_service.finalize_failure"
        ) as failure,
        pytest.raises(StaleImportDispatchAttempt),
    ):
        service.run_pipeline(Mock(), lease, ["original.png"])
    failure.assert_not_called()
    service.storage.materialize_to_local.assert_not_called()
