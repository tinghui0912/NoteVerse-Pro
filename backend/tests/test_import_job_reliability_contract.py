from tests.support.runtime_resources import resources_for

from unittest.mock import Mock

from app.modules.import_jobs.pipeline_runner import ImportPipelineRunner
from app.runtime.worker.main import celery_app
from app.worker.tasks import import_dispatch_task
from app.platform.config.application import ImportExecutionConfig
from app.runtime.worker.settings import WorkerSettings


def test_import_job_keeps_celery_delivery_guarantees() -> None:
    assert import_dispatch_task.acks_late is True
    assert import_dispatch_task.reject_on_worker_lost is True
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_reject_on_worker_lost is True
    assert celery_app.conf.worker_prefetch_multiplier == 1


def test_worker_materializes_admitted_inputs_without_metadata_probes(tmp_path, monkeypatch) -> None:
    from app.modules.media_storage.reads import StoredObjectReadTarget

    storage = Mock()
    storage.iter_bytes.return_value = iter([b"input"])
    for method in (storage.exists, storage.object_metadata, storage.size_bytes):
        method.side_effect = AssertionError("Physical metadata is not read authority")
    destination = tmp_path / "input.png"
    monkeypatch.setattr(
        "app.modules.import_jobs.pipeline_runner.object_work_path",
        lambda _, *, work_root: str(destination),
    )
    service = ImportPipelineRunner(
        recorder=resources_for().build_import_artifact_recorder().recorder,
        writes=resources_for(storage).build_object_write_coordinator(),
        sessions=resources_for().sessions,
        config=ImportExecutionConfig.model_validate(WorkerSettings().model_dump()),
    )
    paths = service._resolve_input_paths(
        [StoredObjectReadTarget(1, "blobs/input.png", 5, "image/png")]
    )
    assert paths == [str(destination)] and destination.read_bytes() == b"input"
    storage.iter_bytes.assert_called_once_with("blobs/input.png", chunk_size=64 * 1024)
