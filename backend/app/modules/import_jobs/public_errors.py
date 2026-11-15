"""Customer product failure codes projected from canonical Import failure facts."""

from typing import Protocol

from app.shared.constants import ErrorCode


class ImportFailureFacts(Protocol):
    failure_code: str | None
    failure_stage: str | None


PUBLIC_IMPORT_FAILURE_CODES = {
    ("import_pipeline_timeout", "pipeline"): ErrorCode.TASK_TIMEOUT,
    ("import_inputs_unavailable", "pipeline"): ErrorCode.INPUT_FILE_MISSING,
    ("import_pipeline_rejected", "pipeline"): ErrorCode.SCORE_RECOGNITION_FAILED,
    ("import_pipeline_failed", "pipeline"): ErrorCode.TASK_ERROR,
    ("import_dispatch_attempts_exhausted", "dispatch"): ErrorCode.FEATURE_TEMPORARILY_UNAVAILABLE,
    ("import_inputs_unavailable", "dispatch"): ErrorCode.FEATURE_TEMPORARILY_UNAVAILABLE,
}


def public_import_job_error_code(job: ImportFailureFacts) -> str | None:
    if job.failure_code is None or job.failure_stage is None:
        return None
    return PUBLIC_IMPORT_FAILURE_CODES.get((job.failure_code, job.failure_stage))
