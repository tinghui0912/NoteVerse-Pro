from __future__ import annotations

from celery.exceptions import SoftTimeLimitExceeded

from app.core.exceptions import PipelineException
from app.core.logger import logger
from app.modules.durable_work.failure import DurableFailure, DurableFailureClass
from app.modules.import_jobs.dispatch_service import (
    ImportExecutionLease,
    StaleImportDispatchAttempt,
    require_current_attempt,
)
from app.db.session import SessionLocal
from app.modules.import_jobs.schemas import (
    ImportJobProcessingOptions,
    PipelineExecutionSuccessResult,
)
from app.modules.import_jobs.worker_service import import_job_execution_service
from app.modules.import_jobs.execution_manifest import bind_import_job_execution_manifest
from app.modules.import_jobs.pipeline import JobContext, PipelineBuilder
from app.task_queue.protocols import CeleryTaskLike
from app.shared.constants import ErrorCode
from app.storage import ObjectStorage, object_storage
from app.storage.paths import object_work_path
from app.shared.time import utc_now


class ImportJobExecutionService:
    def __init__(self, storage: ObjectStorage | None = None) -> None:
        self.storage = storage or object_storage

    @staticmethod
    def get_error_code(exception: Exception) -> str:
        if isinstance(exception, SoftTimeLimitExceeded):
            return ErrorCode.TASK_TIMEOUT
        if isinstance(exception, PipelineException):
            return exception.code
        return ErrorCode.UNKNOWN_ERROR

    @staticmethod
    def failure_for_exception(exception: Exception) -> DurableFailure:
        if isinstance(exception, SoftTimeLimitExceeded) or (
            isinstance(exception, PipelineException) and exception.code == ErrorCode.TASK_TIMEOUT
        ):
            return DurableFailure(
                "import_pipeline_timeout", "pipeline", DurableFailureClass.TRANSIENT, False
            )
        if isinstance(exception, PipelineException):
            if exception.code in (ErrorCode.INPUT_FILE_MISSING,):
                return DurableFailure(
                    "import_inputs_unavailable", "pipeline", DurableFailureClass.PERMANENT, False
                )
            if exception.code in (ErrorCode.SCORE_RECOGNITION_FAILED,):
                return DurableFailure(
                    "import_pipeline_rejected", "pipeline", DurableFailureClass.USER_ERROR, False
                )
        return DurableFailure(
            "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
        )

    def _resolve_input_paths(self, storage_keys: list[str]) -> list[str]:
        return [
            self.storage.materialize_to_local(
                storage_key,
                object_work_path(storage_key),
            )
            for storage_key in storage_keys
        ]

    def run_pipeline(
        self,
        celery_task: CeleryTaskLike,
        lease: ImportExecutionLease,
        storage_keys: list[str],
        options: ImportJobProcessingOptions | None = None,
    ) -> PipelineExecutionSuccessResult:
        job_id = lease.job_uuid
        try:
            with SessionLocal() as db:
                require_current_attempt(db, lease)
                db.commit()
            image_paths = self._resolve_input_paths(storage_keys)
            with SessionLocal() as db:
                bind_import_job_execution_manifest(db, lease)
                context = JobContext(
                    lease=lease,
                    db=db,
                    celery_task=celery_task,
                    image_paths=image_paths,
                    options=options or {},
                )
                context.status(
                    "RUNNING",
                    "initialization",
                    0,
                    current_step="initialization",
                    started_at=utc_now(),
                )
                context.update_celery_state("initialization", 0, "initialization")
                pipeline = PipelineBuilder.build(image_paths, options)
                logger.bind(
                    event="import_job.pipeline_started",
                    job_id=job_id,
                    operation_id=lease.dispatch_uuid,
                    pipeline=repr(pipeline),
                ).info("Import job pipeline started")
                pipeline.run(context)
                context.status("RUNNING", "completed", 100, current_step="ocr_completed")
                context.complete()
                db.commit()
                return {"success": True, "job_id": job_id}
        except StaleImportDispatchAttempt:
            raise
        except Exception as exc:
            code = self.get_error_code(exc)
            logger.bind(
                event="import_job.pipeline_failed",
                job_id=job_id,
                public_code=code,
                exception_type=type(exc).__name__,
            ).opt(exception=exc).error("Import job pipeline failed")
            try:
                with SessionLocal() as db:
                    import_job_execution_service.finalize_failure(
                        db,
                        lease,
                        error=code,
                        error_type=type(exc).__name__,
                        code=code,
                        failure=self.failure_for_exception(exc),
                        detail=str(exc),
                    )
                    db.commit()
            except StaleImportDispatchAttempt:
                raise
            except Exception:
                pass
            raise


job_execution_service = ImportJobExecutionService()
