from __future__ import annotations

from celery.exceptions import SoftTimeLimitExceeded

from app.core.exceptions import PipelineException
from app.core.logger import logger
from app.db.worker_session import get_worker_db
from app.modules.jobs.schemas import (
    JobProcessingOptions,
    PipelineExecutionSuccessResult,
)
from app.modules.jobs.worker_service import sync_job_service
from app.pipeline import JobContext, PipelineBuilder
from app.pipeline.context import CeleryTaskLike
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


class JobExecutionService:
    def __init__(self, storage: FileStorage | None = None) -> None:
        self.storage = storage or file_storage

    @staticmethod
    def get_error_code(exception: Exception) -> str:
        if isinstance(exception, SoftTimeLimitExceeded):
            return ErrorCode.TASK_TIMEOUT
        if isinstance(exception, PipelineException):
            return exception.code
        return ErrorCode.UNKNOWN_ERROR

    def _resolve_input_paths(self, upload_ids: list[str]) -> list[str]:
        return self.storage.resolve_score_uploads(upload_ids)

    def run_pipeline(
        self,
        celery_task: CeleryTaskLike,
        upload_ids: list[str],
        options: JobProcessingOptions | None = None,
    ) -> PipelineExecutionSuccessResult:
        job_id = celery_task.request.id
        try:
            image_paths = self._resolve_input_paths(upload_ids)
            with get_worker_db() as db:
                context = JobContext(
                    job_id=job_id,
                    db=db,
                    celery_task=celery_task,
                    image_paths=image_paths,
                    options=options or {},
                )
                context.status(
                    "PROGRESS",
                    "initialization",
                    0,
                    current_step="initialization",
                    started_at=utc_now_naive(),
                )
                context.update_celery_state("initialization", 0, "initialization")
                pipeline = PipelineBuilder.build(image_paths, options)
                logger.info(f"[{job_id}] Running pipeline: {pipeline}")
                pipeline.run(context)
                context.status("PROGRESS", "completed", 100, current_step="ocr_completed")
                context.complete()
                return {"success": True, "job_id": job_id}
        except Exception as exc:
            logger.error(f"[{job_id}] Job failed: {exc}", exc_info=True)
            try:
                with get_worker_db() as db:
                    sync_job_service.finalize_failure(
                        db,
                        job_id,
                        error=str(exc),
                        error_type=type(exc).__name__,
                        code=self.get_error_code(exc),
                    )
            except Exception:
                pass
            raise


job_execution_service = JobExecutionService()
