from app.modules.storage_objects.reads import StoredObjectReadTarget
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from celery.exceptions import SoftTimeLimitExceeded

from app.core.exceptions import TimeoutException, PipelineException
from app.shared.constants import ErrorCode
from app.modules.import_jobs.dispatch_service import (
    ImportExecutionLease,
    StaleImportDispatchAttempt,
)
from app.modules.import_jobs.pipeline_runner import ImportPipelineRunner
from app.modules.durable_work.failure import DurableFailure, DurableFailureClass
from app.modules.storage_objects.reads import StoredObjectIntegrityError


def test_soft_time_limit_maps_to_pipeline_timeout() -> None:
    assert ImportPipelineRunner.failure_for_exception(SoftTimeLimitExceeded()) == DurableFailure(
        "import_pipeline_timeout", "pipeline", DurableFailureClass.TRANSIENT, False
    )


def test_pipeline_timeout_has_transient_terminal_facts() -> None:
    assert ImportPipelineRunner.failure_for_exception(TimeoutException()) == DurableFailure(
        "import_pipeline_timeout", "pipeline", DurableFailureClass.TRANSIENT, False
    )


def test_admitted_input_loss_has_system_failure_facts() -> None:
    assert ImportPipelineRunner.failure_for_exception(
        StoredObjectIntegrityError()
    ) == DurableFailure(
        "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
    )


@pytest.mark.parametrize(
    "code,expected,classification",
    [
        (ErrorCode.INPUT_FILE_MISSING, "import_inputs_unavailable", DurableFailureClass.PERMANENT),
        (
            ErrorCode.SCORE_RECOGNITION_FAILED,
            "import_pipeline_rejected",
            DurableFailureClass.USER_ERROR,
        ),
    ],
)
def test_pipeline_rejections_have_explicit_failure_facts(code, expected, classification):
    assert ImportPipelineRunner.failure_for_exception(PipelineException(code)) == DurableFailure(
        expected, "pipeline", classification, False
    )


def test_successful_pipeline_records_progress_and_accepts_its_review_outcome():
    service = ImportPipelineRunner(storage=Mock())
    task, context, pipeline = Mock(), Mock(), Mock()
    lease = ImportExecutionLease(dispatch_uuid="delivery", job_uuid="job", attempt=1, token="token")
    order = []

    def resolve_inputs(inputs):
        assert order == ["start"]
        order.append("materialize")
        return ["input.png"]

    @contextmanager
    def database_scope():
        yield Mock()

    with (
        patch("app.modules.import_jobs.pipeline_runner.SessionLocal", database_scope),
        patch(
            "app.modules.import_jobs.pipeline_runner.import_execution_recorder.start_execution",
            side_effect=lambda *_: order.append("start"),
        ) as start,
        patch(
            "app.modules.import_jobs.pipeline_runner.bind_import_job_execution_manifest",
            side_effect=lambda *_: order.append("manifest"),
        ),
        patch.object(service, "_resolve_input_paths", side_effect=resolve_inputs),
        patch("app.modules.import_jobs.pipeline_runner.JobContext", return_value=context),
        patch(
            "app.modules.import_jobs.pipeline_runner.PipelineBuilder.build", return_value=pipeline
        ),
    ):
        assert service.run_pipeline(task, lease, []) == {"success": True, "job_id": "job"}
    assert order == ["start", "materialize", "manifest"]
    start.assert_called_once()
    pipeline.run.assert_called_once_with(context)
    context.progress.assert_any_call("initialization", 0, current_step="initialization")
    context.progress.assert_any_call("completed", 100, current_step="ocr_completed")
    context.complete.assert_called_once_with()


def test_pipeline_failure_is_persisted_and_reraised() -> None:
    service = ImportPipelineRunner(storage=Mock())
    service.storage.iter_bytes.return_value = iter([b"input"])
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
        patch("app.modules.import_jobs.pipeline_runner.import_execution_recorder.start_execution"),
        patch("app.modules.import_jobs.pipeline_runner.bind_import_job_execution_manifest"),
        patch(
            "app.modules.import_jobs.pipeline_runner.SessionLocal",
            side_effect=database_scope,
        ),
        patch(
            "app.modules.import_jobs.pipeline_runner.JobContext",
            return_value=context,
        ),
        patch(
            "app.modules.import_jobs.pipeline_runner.PipelineBuilder.build",
            return_value=pipeline,
        ),
        patch(
            "app.modules.import_jobs.pipeline_runner.import_execution_recorder.finalize_failure"
        ) as finalize_failure,
        pytest.raises(TimeoutException),
    ):
        service.run_pipeline(task, lease, [StoredObjectReadTarget(1, "upload-id", 5, "image/png")])

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
    service = ImportPipelineRunner(storage=Mock())
    lease = ImportExecutionLease(dispatch_uuid="delivery", job_uuid="job", attempt=1, token="token")

    @contextmanager
    def database_scope():
        yield Mock()

    with (
        patch("app.modules.import_jobs.pipeline_runner.SessionLocal", database_scope),
        patch(
            "app.modules.import_jobs.pipeline_runner.import_execution_recorder.start_execution",
            side_effect=StaleImportDispatchAttempt("lost"),
        ),
        patch(
            "app.modules.import_jobs.pipeline_runner.import_execution_recorder.finalize_failure"
        ) as failure,
        patch.object(service, "_resolve_input_paths") as materialize,
        pytest.raises(StaleImportDispatchAttempt),
    ):
        service.run_pipeline(Mock(), lease, ["original.png"])
    failure.assert_not_called()
    materialize.assert_not_called()
