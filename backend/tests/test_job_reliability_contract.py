from unittest.mock import Mock

from app.modules.jobs.execution_service import JobExecutionService
from app.worker.celery_config import celery_app
from app.worker.tasks import process_images_job


def test_processing_job_keeps_celery_delivery_guarantees() -> None:
    assert process_images_job.acks_late is True
    assert process_images_job.reject_on_worker_lost is True
    assert celery_app.conf.task_acks_late is True
    assert celery_app.conf.task_reject_on_worker_lost is True
    assert celery_app.conf.worker_prefetch_multiplier == 1


def test_worker_materializes_durable_upload_ids() -> None:
    storage = Mock()
    storage.resolve_score_uploads.return_value = ["/worker/materialized/input.png"]
    service = JobExecutionService(storage=storage)

    paths = service._resolve_input_paths(["sha256-upload-id"])

    assert paths == ["/worker/materialized/input.png"]
    storage.resolve_score_uploads.assert_called_once_with(["sha256-upload-id"])
