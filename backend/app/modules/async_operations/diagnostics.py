from __future__ import annotations

import enum
from dataclasses import dataclass


class AsyncOperationKindValue(str, enum.Enum):
    IMPORT = "import"
    RENDER = "render"
    PLAYBACK = "playback"
    MAIL = "mail"
    SCORE_DELETION = "score_deletion"


class AsyncOperationStatusValue(str, enum.Enum):
    QUEUED = "queued"
    DISPATCHED = "dispatched"
    PROCESSING = "processing"
    RETRYING = "retrying"
    SUCCEEDED = "succeeded"
    FAILED = "failed"
    PERMANENT_FAILED = "permanent_failed"
    EXPIRED = "expired"
    EXHAUSTED = "exhausted"
    BLOCKED = "blocked"


class AsyncOperationErrorClassValue(str, enum.Enum):
    TRANSIENT = "transient"
    PERMANENT = "permanent"
    USER_ERROR = "user_error"
    SYSTEM_ERROR = "system_error"
    UNKNOWN = "unknown"


@dataclass(frozen=True)
class AsyncOperationDiagnosticValue:
    internal_code: str | None
    internal_stage: str | None
    internal_error_class: AsyncOperationErrorClassValue | None
    retryable: bool


def clear_async_diagnostic(record: object) -> None:
    setattr(record, "internal_error_code", None)
    setattr(record, "internal_error_stage", None)
    setattr(record, "internal_error_class", None)
    setattr(record, "internal_error_retryable", None)


def apply_async_diagnostic(
    record: object,
    *,
    kind: AsyncOperationKindValue,
    status: AsyncOperationStatusValue | str,
    raw_status: str,
    last_error: str | None,
    attempts: int,
    max_attempts: int | None,
) -> None:
    diagnostic = build_async_diagnostic(
        kind=kind,
        status=status,
        raw_status=raw_status,
        last_error=last_error,
        attempts=attempts,
        max_attempts=max_attempts,
    )
    if diagnostic is None:
        clear_async_diagnostic(record)
        return
    setattr(record, "internal_error_code", diagnostic.internal_code)
    setattr(record, "internal_error_stage", diagnostic.internal_stage)
    setattr(
        record,
        "internal_error_class",
        diagnostic.internal_error_class.value if diagnostic.internal_error_class is not None else None,
    )
    setattr(record, "internal_error_retryable", diagnostic.retryable)


def classify_async_error(error: str | None) -> AsyncOperationErrorClassValue | None:
    if not error:
        return None
    normalized = error.lower()
    if any(
        marker in normalized
        for marker in (
            "unsupported",
            "invalid file",
            "invalid input",
            "corrupt",
            "parse",
        )
    ):
        return AsyncOperationErrorClassValue.USER_ERROR
    if any(
        marker in normalized
        for marker in (
            "references unavailable",
            "stale resources",
            "body is unavailable",
            "permanent",
            "expired",
        )
    ):
        return AsyncOperationErrorClassValue.PERMANENT
    if any(
        marker in normalized
        for marker in (
            "timeout",
            "temporarily",
            "unavailable",
            "connection",
            "lease expired",
            "worker",
            "redis",
            "s3",
            "storage",
            "smtp",
        )
    ):
        return AsyncOperationErrorClassValue.TRANSIENT
    if any(marker in normalized for marker in ("traceback", "exception", "failed")):
        return AsyncOperationErrorClassValue.SYSTEM_ERROR
    return AsyncOperationErrorClassValue.UNKNOWN


def build_async_diagnostic(
    *,
    kind: AsyncOperationKindValue | str,
    status: AsyncOperationStatusValue | str,
    raw_status: str,
    last_error: str | None,
    attempts: int,
    max_attempts: int | None,
) -> AsyncOperationDiagnosticValue | None:
    kind_value = kind.value if isinstance(kind, AsyncOperationKindValue) else kind
    status_value = status.value if isinstance(status, AsyncOperationStatusValue) else status
    error_class = classify_async_error(last_error)
    if last_error is None and error_class is None and status_value not in {
        AsyncOperationStatusValue.FAILED.value,
        AsyncOperationStatusValue.PERMANENT_FAILED.value,
        AsyncOperationStatusValue.EXPIRED.value,
        AsyncOperationStatusValue.EXHAUSTED.value,
        AsyncOperationStatusValue.BLOCKED.value,
    }:
        return None

    return AsyncOperationDiagnosticValue(
        internal_code=internal_code(
            kind=kind_value,
            status=status_value,
            raw_status=raw_status,
            error_class=error_class,
            last_error=last_error,
        ),
        internal_stage=internal_stage(kind_value, raw_status),
        internal_error_class=error_class,
        retryable=is_retryable(status=status_value, attempts=attempts, max_attempts=max_attempts),
    )


def internal_stage(kind: str, raw_status: str) -> str:
    if kind == AsyncOperationKindValue.IMPORT.value:
        if "/" in raw_status:
            state, dispatch = raw_status.split("/", 1)
            if dispatch in {"PENDING", "DISPATCHED", "FAILED"}:
                return "dispatch"
            return state.lower()
        return "import"
    if kind == AsyncOperationKindValue.RENDER.value:
        return "render"
    if kind == AsyncOperationKindValue.PLAYBACK.value:
        return "playback"
    if kind == AsyncOperationKindValue.MAIL.value:
        return "delivery"
    if kind == AsyncOperationKindValue.SCORE_DELETION.value:
        return "cleanup"
    return kind


def internal_code(
    *,
    kind: str,
    status: str,
    raw_status: str,
    error_class: AsyncOperationErrorClassValue | None,
    last_error: str | None,
) -> str:
    normalized = (last_error or raw_status).lower()
    if status == AsyncOperationStatusValue.EXPIRED.value or "expired" in normalized:
        return f"{kind}_expired"
    if status == AsyncOperationStatusValue.EXHAUSTED.value:
        return f"{kind}_attempts_exhausted"
    if "lease expired" in normalized:
        return f"{kind}_lease_expired"
    if "references unavailable" in normalized or "stale resources" in normalized:
        return f"{kind}_stale_resources"
    if "body is unavailable" in normalized:
        return f"{kind}_body_unavailable"
    if "timeout" in normalized:
        return f"{kind}_timeout"
    if error_class == AsyncOperationErrorClassValue.TRANSIENT:
        return f"{kind}_transient_failure"
    if error_class == AsyncOperationErrorClassValue.PERMANENT:
        return f"{kind}_permanent_failure"
    if error_class == AsyncOperationErrorClassValue.USER_ERROR:
        return f"{kind}_user_input_error"
    if error_class == AsyncOperationErrorClassValue.SYSTEM_ERROR:
        return f"{kind}_system_failure"
    if error_class == AsyncOperationErrorClassValue.UNKNOWN:
        return f"{kind}_unknown_failure"
    return f"{kind}_status_{status}"


def is_retryable(*, status: str, attempts: int, max_attempts: int | None) -> bool:
    if status in {
        AsyncOperationStatusValue.SUCCEEDED.value,
        AsyncOperationStatusValue.PROCESSING.value,
        AsyncOperationStatusValue.DISPATCHED.value,
        AsyncOperationStatusValue.PERMANENT_FAILED.value,
        AsyncOperationStatusValue.EXPIRED.value,
        AsyncOperationStatusValue.EXHAUSTED.value,
        AsyncOperationStatusValue.BLOCKED.value,
    }:
        return False
    if max_attempts is not None and attempts >= max_attempts:
        return False
    return status in {
        AsyncOperationStatusValue.QUEUED.value,
        AsyncOperationStatusValue.RETRYING.value,
        AsyncOperationStatusValue.FAILED.value,
    }
