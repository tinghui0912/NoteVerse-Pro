from tests.support.runtime_resources import resources_for

from app.modules.media_storage.reads import StoredObjectReadTarget
from contextlib import contextmanager
from types import SimpleNamespace
from unittest.mock import Mock, patch

import pytest
from celery.exceptions import SoftTimeLimitExceeded

from app.core.exceptions import TimeoutException, PipelineException
from app.shared.error_codes import CustomerErrorCode
from app.modules.import_jobs.dispatch_service import (
    ImportExecutionLease,
    StaleImportDispatchAttempt,
)
from app.modules.import_jobs.pipeline_runner import ImportPipelineRunner
from app.modules.durable_work.failure import DurableFailure
from app.shared.durable_failure import DurableFailureClass
from app.modules.media_storage.reads import StoredObjectIntegrityError
from app.platform.config.application import ImportExecutionConfig
from app.runtime.worker.settings import WorkerSettings


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
        (
            CustomerErrorCode.INPUT_FILE_MISSING,
            "import_inputs_unavailable",
            DurableFailureClass.PERMANENT,
        ),
        (
            CustomerErrorCode.SCORE_RECOGNITION_FAILED,
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
    service = ImportPipelineRunner(
        recorder=resources_for().build_import_artifact_recorder().recorder,
        writes=resources_for(Mock()).build_object_write_coordinator(),
        sessions=resources_for().sessions,
        config=ImportExecutionConfig.model_validate(WorkerSettings().model_dump()),
    )
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
        patch.object(service, "sessions", database_scope),
        patch.object(
            service.recorder,
            "start_execution",
            side_effect=lambda *_: order.append("start"),
        ) as start,
        patch(
            "app.modules.import_jobs.pipeline_runner.bind_import_job_execution_manifest",
            side_effect=lambda *_: order.append("manifest"),
        ),
        patch.object(service, "_resolve_input_paths", side_effect=resolve_inputs),
        patch(
            "app.modules.import_jobs.pipeline_runner.JobContext", return_value=context
        ) as context_factory,
        patch(
            "app.modules.import_jobs.pipeline_runner.PipelineBuilder.build", return_value=pipeline
        ) as builder,
    ):
        assert service.run_pipeline(task, lease, []) == {"success": True, "job_id": "job"}
    assert "options" not in context_factory.call_args.kwargs
    builder.assert_called_once_with(["input.png"])
    assert order == ["start", "materialize", "manifest"]
    start.assert_called_once()
    pipeline.run.assert_called_once_with(context)
    context.progress.assert_any_call("initialization", 0, current_step="initialization")
    context.progress.assert_any_call("completed", 100, current_step="ocr_completed")
    context.complete.assert_called_once_with()


def test_pipeline_failure_is_persisted_and_reraised() -> None:
    service = ImportPipelineRunner(
        recorder=resources_for().build_import_artifact_recorder().recorder,
        writes=resources_for(Mock()).build_object_write_coordinator(),
        sessions=resources_for().sessions,
        config=ImportExecutionConfig.model_validate(WorkerSettings().model_dump()),
    )
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
        patch.object(service.recorder, "start_execution"),
        patch("app.modules.import_jobs.pipeline_runner.bind_import_job_execution_manifest"),
        patch.object(
            service,
            "sessions",
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
        patch.object(service.recorder, "finalize_failure") as finalize_failure,
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
    service = ImportPipelineRunner(
        recorder=resources_for().build_import_artifact_recorder().recorder,
        writes=resources_for(Mock()).build_object_write_coordinator(),
        sessions=resources_for().sessions,
        config=ImportExecutionConfig.model_validate(WorkerSettings().model_dump()),
    )
    lease = ImportExecutionLease(dispatch_uuid="delivery", job_uuid="job", attempt=1, token="token")

    @contextmanager
    def database_scope():
        yield Mock()

    with (
        patch.object(service, "sessions", database_scope),
        patch.object(
            service.recorder,
            "start_execution",
            side_effect=StaleImportDispatchAttempt("lost"),
        ),
        patch.object(service.recorder, "finalize_failure") as failure,
        patch.object(service, "_resolve_input_paths") as materialize,
        pytest.raises(StaleImportDispatchAttempt),
    ):
        service.run_pipeline(Mock(), lease, ["original.png"])
    failure.assert_not_called()
    materialize.assert_not_called()
