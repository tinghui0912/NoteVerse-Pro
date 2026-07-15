from __future__ import annotations

from typing import Protocol

from app.shared.constants import ErrorCode


class ImportJobFailureLike(Protocol):
    code: str | None
    error: str | None


PUBLIC_IMPORT_JOB_ERROR_CODES = {
    ErrorCode.FEATURE_TEMPORARILY_UNAVAILABLE,
    ErrorCode.INPUT_FILE_MISSING,
    ErrorCode.JOB_NOT_FOUND,
    ErrorCode.JOB_RUNNING,
    ErrorCode.NO_FILE_IDS,
    ErrorCode.SCORE_RECOGNITION_FAILED,
    ErrorCode.STORAGE_QUOTA_EXCEEDED,
    ErrorCode.TASK_ERROR,
    ErrorCode.TASK_TIMEOUT,
}


def public_import_job_error(job: ImportJobFailureLike) -> tuple[str | None, str | None]:
    if job.code in PUBLIC_IMPORT_JOB_ERROR_CODES:
        return job.code, job.code
    if job.error:
        return ErrorCode.TASK_ERROR, ErrorCode.TASK_ERROR
    return None, None

