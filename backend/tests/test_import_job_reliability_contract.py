from unittest.mock import Mock

from app.modules.import_jobs.execution_service import ImportJobExecutionService
from app.worker.celery_config import celery_app
from app.worker.tasks import process_images_job


def test_import_job_keeps_celery_delivery_guarantees() -> None:
    assert process_images_job.acks_late is True
    assert process_images_job.reject_on_worker_lost is True
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_reject_on_worker_lost is True
    assert celery_app.conf.worker_prefetch_multiplier == 1


def test_worker_materializes_durable_storage_keys() -> None:
    storage = Mock()
    storage.local_path.return_value = "/worker/cache/blob.png"
    storage.materialize_to_local.return_value = "/worker/materialized/input.png"
    service = ImportJobExecutionService(storage=storage)

    paths = service._resolve_input_paths(["blobs/ab/abc123.png"])

    assert paths == ["/worker/materialized/input.png"]
    storage.local_path.assert_called_once_with("blobs/ab/abc123.png")
    storage.materialize_to_local.assert_called_once_with(
        "blobs/ab/abc123.png",
        "/worker/cache/blob.png",
    )
