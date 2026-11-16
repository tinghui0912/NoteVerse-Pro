from unittest.mock import Mock

from app.modules.import_jobs.pipeline_runner import ImportPipelineRunner
from app.task_queue.config import celery_app
from app.worker.tasks import import_dispatch_task


def test_import_job_keeps_celery_delivery_guarantees() -> None:
    assert import_dispatch_task.acks_late is True
    assert import_dispatch_task.reject_on_worker_lost is True
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_reject_on_worker_lost is True
    assert celery_app.conf.worker_prefetch_multiplier == 1


def test_worker_materializes_admitted_inputs_without_metadata_probes(tmp_path, monkeypatch) -> None:
    from app.modules.storage_objects.reads import StoredObjectReadTarget

    storage = Mock()
    storage.iter_bytes.return_value = iter([b"input"])
    for method in (storage.exists, storage.object_metadata, storage.size_bytes):
        method.side_effect = AssertionError("Physical metadata is not read authority")
    destination = tmp_path / "input.png"
    monkeypatch.setattr(
        "app.modules.import_jobs.pipeline_runner.object_work_path", lambda _: str(destination)
    )
    service = ImportPipelineRunner(storage=storage)
    paths = service._resolve_input_paths(
        [StoredObjectReadTarget(1, "blobs/input.png", 5, "image/png")]
    )
    assert paths == [str(destination)] and destination.read_bytes() == b"input"
    storage.iter_bytes.assert_called_once_with("blobs/input.png")
