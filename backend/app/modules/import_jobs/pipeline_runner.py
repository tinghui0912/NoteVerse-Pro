from __future__ import annotations
from app.modules.storage_objects.reads import StoredObjectReadTarget, materialize_admitted_object

from celery.exceptions import SoftTimeLimitExceeded

from app.core.exceptions import PipelineException
from app.core.logger import logger
from app.modules.durable_work.failure import DurableFailure, DurableFailureClass
from app.modules.import_jobs.dispatch_service import (
    ImportExecutionLease,
    StaleImportDispatchAttempt,
)
from app.db.session import SessionLocal
from app.modules.import_jobs.schemas import (
    PipelineExecutionSuccessResult,
)
from app.modules.import_jobs.execution_recorder import import_execution_recorder
from app.modules.import_jobs.execution_manifest import bind_import_job_execution_manifest
from app.modules.import_jobs.pipeline import JobContext, PipelineBuilder
from app.task_queue.protocols import CeleryTaskLike
from app.shared.error_codes import CustomerErrorCode
from app.storage import ObjectStorage, object_storage
from app.storage.paths import object_work_path


class ImportPipelineRunner:
    def __init__(self, storage: ObjectStorage | None = None) -> None:
        self.storage = storage or object_storage

    @staticmethod
    def failure_for_exception(exception: Exception) -> DurableFailure:
        if isinstance(exception, SoftTimeLimitExceeded) or (
            isinstance(exception, PipelineException)
            and exception.code == CustomerErrorCode.TASK_TIMEOUT
        ):
            return DurableFailure(
                "import_pipeline_timeout", "pipeline", DurableFailureClass.TRANSIENT, False
            )
        if isinstance(exception, PipelineException):
            if exception.code in (CustomerErrorCode.INPUT_FILE_MISSING,):
                return DurableFailure(
                    "import_inputs_unavailable", "pipeline", DurableFailureClass.PERMANENT, False
                )
            if exception.code in (CustomerErrorCode.SCORE_RECOGNITION_FAILED,):
                return DurableFailure(
                    "import_pipeline_rejected", "pipeline", DurableFailureClass.USER_ERROR, False
                )
        return DurableFailure(
            "import_pipeline_failed", "pipeline", DurableFailureClass.SYSTEM_ERROR, False
        )

    def _resolve_input_paths(self, inputs: list[StoredObjectReadTarget]) -> list[str]:
        return [
            materialize_admitted_object(self.storage, target, object_work_path(target.storage_key))
            for target in inputs
        ]

    def run_pipeline(
        self,
        celery_task: CeleryTaskLike,
        lease: ImportExecutionLease,
        inputs: list[StoredObjectReadTarget],
    ) -> PipelineExecutionSuccessResult:
        job_id = lease.job_uuid
        try:
            with SessionLocal() as db:
                import_execution_recorder.start_execution(db, lease)
            image_paths = self._resolve_input_paths(inputs)
            with SessionLocal() as db:
                bind_import_job_execution_manifest(db, lease)
                context = JobContext(
                    lease=lease,
                    db=db,
                    celery_task=celery_task,
                    image_paths=image_paths,
                )
                context.progress(
                    "initialization",
                    0,
                    current_step="initialization",
                )
                context.update_celery_state("initialization", 0, "initialization")
                pipeline = PipelineBuilder.build(image_paths)
                logger.bind(
                    event="import_job.pipeline_started",
                    job_id=job_id,
                    operation_id=lease.dispatch_uuid,
                    pipeline=repr(pipeline),
                ).info("Import job pipeline started")
                pipeline.run(context)
                context.progress("completed", 100, current_step="ocr_completed")
                context.complete()
                db.commit()
                return {"success": True, "job_id": job_id}
        except StaleImportDispatchAttempt:
            raise
        except Exception as exc:
            failure = self.failure_for_exception(exc)
            logger.bind(
                event="import_job.pipeline_failed",
                job_id=job_id,
                failure_code=failure.code,
                failure_classification=failure.classification.value,
                exception_type=type(exc).__name__,
            ).opt(exception=exc).error("Import job pipeline failed")
            try:
                with SessionLocal() as db:
                    import_execution_recorder.finalize_failure(
                        db,
                        lease,
                        failure=failure,
                        detail=str(exc),
                    )
                    db.commit()
            except StaleImportDispatchAttempt:
                raise
            except Exception:
                pass
            raise


import_pipeline_runner = ImportPipelineRunner()
