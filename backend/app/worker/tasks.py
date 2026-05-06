"""Celery task entrypoints for image-processing jobs."""

from typing import List, Optional

from celery.utils.log import get_task_logger

from app.modules.tasks.execution_service import task_execution_service
from app.modules.tasks.schemas import (
    PipelineExecutionFailureResult,
    PipelineExecutionSuccessResult,
    TaskProcessingOptions,
)
from app.pipeline.context import CeleryTaskLike
from app.utils.email import send_email
from app.worker.celery_config import celery_app

logger = get_task_logger(__name__)


@celery_app.task(bind=True, name="app.worker.tasks.process_images_task")
def process_images_task(
    self: CeleryTaskLike,
    image_paths: List[str],
    options: Optional[TaskProcessingOptions] = None,
) -> PipelineExecutionSuccessResult | PipelineExecutionFailureResult:
    """Run the image-processing pipeline for one or more input images."""

    return task_execution_service.run_pipeline(self, image_paths, options)


@celery_app.task(
    bind=True,
    name="app.worker.tasks.send_email_task",
    autoretry_for=(RuntimeError,),
    retry_backoff=True,
    retry_jitter=True,
    retry_kwargs={"max_retries": 3},
)
def send_email_task(
    self,
    to_email: str,
    subject: str,
    body: str,
) -> dict[str, str]:
    """Send an email in the background via the configured SMTP provider."""

    send_email(to_email=to_email, subject=subject, body=body)
    logger.info(f"Email sent to {to_email}")
    return {"status": "sent", "to_email": to_email}
