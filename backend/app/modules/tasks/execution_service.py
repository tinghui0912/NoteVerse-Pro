"""Worker-side task execution orchestration for the tasks module."""
from __future__ import annotations

from typing import List, Optional

from app.core.exceptions import PipelineException
from app.core.logger import logger
from app.db.worker_session import get_worker_db
from app.modules.tasks.schemas import (
    PipelineExecutionFailureResult,
    TaskProcessingOptions,
    PipelineExecutionSuccessResult,
)
from app.modules.tasks.worker_service import sync_task_service
from app.pipeline import PipelineBuilder, TaskContext
from app.pipeline.context import CeleryTaskLike
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


class TaskExecutionService:
    """Worker-facing execution service that runs task pipelines."""

    @staticmethod
    def get_error_code(exception: Exception) -> str:
        if isinstance(exception, PipelineException):
            return exception.code
        return ErrorCode.UNKNOWN_ERROR

    def run_pipeline(
        self,
        celery_task: CeleryTaskLike,
        image_paths: List[str],
        options: Optional[TaskProcessingOptions] = None,
    ) -> PipelineExecutionSuccessResult | PipelineExecutionFailureResult:
        task_id = celery_task.request.id
        is_multi = len(image_paths) > 1

        try:
            with get_worker_db() as db:
                ctx = TaskContext(
                    task_id=task_id,
                    db=db,
                    celery_task=celery_task,
                    image_paths=image_paths,
                    options=options or {},
                )

                ctx.status(
                    "PROGRESS",
                    "initialization",
                    0,
                    current_step="initialization",
                    options=options,
                    started_at=utc_now_naive(),
                )
                ctx.update_celery_state("initialization", 0, "initialization")

                if is_multi:
                    logger.info(f"[{task_id}] Batch processing {len(image_paths)} images")

                pipeline = PipelineBuilder.build(image_paths, options)
                logger.info(f"[{task_id}] Running pipeline: {pipeline}")
                pipeline.run(ctx)

                ctx.status("SUCCESS", "completed", 100, current_step="ocr_completed")
                ctx.complete()

                return {"success": True, "task_id": task_id}

        except Exception as exc:
            logger.error(f"[{task_id}] Task failed: {exc}", exc_info=True)

            error_code = self.get_error_code(exc)

            try:
                with get_worker_db() as db:
                    sync_task_service.finalize_failure(
                        db,
                        task_id,
                        error=str(exc),
                        error_type=type(exc).__name__,
                        code=error_code,
                    )
            except Exception:
                pass

            return {"success": False, "error": str(exc)}


task_execution_service = TaskExecutionService()
