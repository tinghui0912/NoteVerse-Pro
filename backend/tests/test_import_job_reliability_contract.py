from unittest.mock import Mock

from app.modules.import_jobs.execution_service import ImportJobExecutionService
from app.storage.paths import object_work_path
from app.task_queue.config import celery_app
from app.worker.tasks import import_dispatch_task


def test_import_job_keeps_celery_delivery_guarantees() -> None:
    assert import_dispatch_task.acks_late is True
    assert import_dispatch_task.reject_on_worker_lost is True
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_reject_on_worker_lost is True
    assert celery_app.conf.worker_prefetch_multiplier == 1


def test_worker_materializes_durable_storage_keys() -> None:
    storage = Mock()
    storage.materialize_to_local.return_value = "/worker/materialized/input.png"
    service = ImportJobExecutionService(storage=storage)

    paths = service._resolve_input_paths(["blobs/ab/abc123.png"])

    assert paths == ["/worker/materialized/input.png"]
    storage.materialize_to_local.assert_called_once_with(
        "blobs/ab/abc123.png",
        object_work_path("blobs/ab/abc123.png"),
    )
