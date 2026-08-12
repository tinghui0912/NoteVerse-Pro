from __future__ import annotations

from collections import Counter
from datetime import datetime

from sqlalchemy import case

from app.core.config import settings
from app.db.models import (
    ImportDispatchStatus,
    ImportJob,
    ImportJobState,
    MailOutbox,
    MailOutboxStatus,
    PlaybackOutbox,
    PlaybackOutboxStatus,
    RenderOutbox,
    RenderOutboxStatus,
    Score,
)
from app.modules.ops.operation_filters import AsyncOperationFilters
from app.modules.ops.schemas import (
    AsyncOperationDiagnostic,
    AsyncOperationErrorClass,
    AsyncOperationKind,
    AsyncOperationRead,
    AsyncOperationStatus,
    AsyncOperationStatusCount,
)
from app.utils.timezone import utc_now_naive


def read_import_operation(job: ImportJob) -> AsyncOperationRead:
    return AsyncOperationRead(
        operation_id=job.job_uuid,
        kind=AsyncOperationKind.IMPORT,
        resource_type="import_job",
        resource_id=job.job_uuid,
        originating_request_id=job.originating_request_id,
        status=import_operation_status(job),
        raw_status=f"{job.state.value}/{job.dispatch_status.value}",
        attempts=job.dispatch_attempt_count,
        max_attempts=settings.IMPORT_DISPATCH_MAX_ATTEMPTS,
        next_attempt_at=job.next_dispatch_at,
        error_class=stored_error_class(job),
        diagnostic=stored_diagnostic(job),
        created_at=job.created_at,
        updated_at=job.updated_at,
    )


def read_render_operation(outbox: RenderOutbox) -> AsyncOperationRead:
    status = outbox_operation_status(
        outbox.status,
        attempts=outbox.attempt_count,
        max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
        next_attempt_at=outbox.next_attempt_at,
    )
    return AsyncOperationRead(
        operation_id=outbox.outbox_uuid,
        kind=AsyncOperationKind.RENDER,
        resource_type=outbox.target_type.value.lower(),
        resource_id=outbox.outbox_uuid,
        originating_request_id=outbox.originating_request_id,
        status=status,
        raw_status=outbox.status.value,
        attempts=outbox.attempt_count,
        max_attempts=settings.RENDER_OUTBOX_MAX_ATTEMPTS,
        next_attempt_at=outbox.next_attempt_at,
        error_class=stored_error_class(outbox),
        diagnostic=stored_diagnostic(outbox),
        created_at=outbox.created_at,
        updated_at=outbox.updated_at,
    )


def read_playback_operation(outbox: PlaybackOutbox) -> AsyncOperationRead:
    status = outbox_operation_status(
        outbox.status,
        attempts=outbox.attempt_count,
        max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        next_attempt_at=outbox.next_attempt_at,
    )
    return AsyncOperationRead(
        operation_id=outbox.outbox_uuid,
        kind=AsyncOperationKind.PLAYBACK,
        resource_type=outbox.asset_kind.value.lower(),
        resource_id=outbox.outbox_uuid,
        originating_request_id=outbox.originating_request_id,
        status=status,
        raw_status=outbox.status.value,
        attempts=outbox.attempt_count,
        max_attempts=settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
        next_attempt_at=outbox.next_attempt_at,
        error_class=stored_error_class(outbox),
        diagnostic=stored_diagnostic(outbox),
        created_at=outbox.created_at,
        updated_at=outbox.updated_at,
    )


def read_mail_operation(outbox: MailOutbox) -> AsyncOperationRead:
    status = mail_operation_status(outbox)
    return AsyncOperationRead(
        operation_id=outbox.outbox_uuid,
        kind=AsyncOperationKind.MAIL,
        resource_type=outbox.category,
        resource_id=outbox.outbox_uuid,
        originating_request_id=outbox.originating_request_id,
        status=status,
        raw_status=outbox.status.value,
        attempts=outbox.attempt_count,
        max_attempts=settings.MAIL_OUTBOX_MAX_ATTEMPTS,
        next_attempt_at=outbox.next_attempt_at,
        error_class=stored_error_class(outbox),
        diagnostic=stored_diagnostic(outbox),
        created_at=outbox.created_at,
        updated_at=outbox.updated_at,
    )


def read_score_deletion_operation(score: Score) -> AsyncOperationRead:
    status = score_deletion_operation_status(score)
    return AsyncOperationRead(
        operation_id=score.score_uuid,
        kind=AsyncOperationKind.SCORE_DELETION,
        resource_type="score",
        resource_id=score.score_uuid,
        originating_request_id=score.deletion_request_id,
        status=status,
        raw_status=score.deletion_status.value,
        attempts=score.cleanup_attempt_count,
        max_attempts=settings.SCORE_DELETION_CLEANUP_MAX_ATTEMPTS,
        next_attempt_at=score.next_cleanup_at,
        error_class=stored_error_class(score),
        diagnostic=stored_diagnostic(score),
        created_at=score.deletion_requested_at or score.deleted_at,
        updated_at=score.updated_at,
    )


def outbox_operation_status_sql(
    status_column,
    attempt_count_column,
    max_attempts: int,
    next_attempt_at_column,
):
    return case(
        (status_column == "COMPLETED", AsyncOperationStatus.SUCCEEDED.value),
        (status_column == "PROCESSING", AsyncOperationStatus.PROCESSING.value),
        (status_column == "DISPATCHED", AsyncOperationStatus.DISPATCHED.value),
        (
            (status_column == "FAILED") & (attempt_count_column >= max_attempts),
            AsyncOperationStatus.EXHAUSTED.value,
        ),
        (
            (status_column == "FAILED") & (next_attempt_at_column > utc_now_naive()),
            AsyncOperationStatus.RETRYING.value,
        ),
        (status_column == "FAILED", AsyncOperationStatus.FAILED.value),
        else_=AsyncOperationStatus.QUEUED.value,
    )


def summary_predicates(
    filters: AsyncOperationFilters,
    *,
    status_expr,
    error_class_expr,
    resource_type_expr,
    created_at_expr,
    updated_at_expr,
) -> list[object]:
    predicates: list[object] = []
    if filters.status is not None:
        predicates.append(status_expr == filters.status.value)
    if filters.error_class is not None:
        predicates.append(error_class_expr == filters.error_class.value)
    if filters.resource_type is not None:
        predicates.append(resource_type_expr == filters.resource_type)
    if filters.created_after is not None:
        predicates.append(created_at_expr >= filters.created_after)
    if filters.updated_before is not None:
        predicates.append(updated_at_expr <= filters.updated_before)
    return predicates


def summary_result_rows(
    kind: AsyncOperationKind,
    rows: list[tuple[object, int]],
) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
    return [(kind, AsyncOperationStatus(str(status)), int(count)) for status, count in rows]


def import_operation_status(job: ImportJob) -> AsyncOperationStatus:
    if job.state in {ImportJobState.PENDING_REVIEW, ImportJobState.CONFIRMED}:
        return AsyncOperationStatus.SUCCEEDED
    if job.state == ImportJobState.RUNNING or job.dispatch_status == ImportDispatchStatus.PROCESSING:
        return AsyncOperationStatus.PROCESSING
    if job.dispatch_status == ImportDispatchStatus.DISPATCHED:
        return AsyncOperationStatus.DISPATCHED
    if job.state == ImportJobState.FAILURE:
        if job.dispatch_attempt_count >= settings.IMPORT_DISPATCH_MAX_ATTEMPTS:
            return AsyncOperationStatus.EXHAUSTED
        return AsyncOperationStatus.FAILED
    if job.dispatch_status == ImportDispatchStatus.FAILED:
        return AsyncOperationStatus.RETRYING
    return AsyncOperationStatus.QUEUED


def outbox_operation_status(
    status: RenderOutboxStatus | PlaybackOutboxStatus,
    *,
    attempts: int,
    max_attempts: int,
    next_attempt_at: datetime,
) -> AsyncOperationStatus:
    if status.value == "COMPLETED":
        return AsyncOperationStatus.SUCCEEDED
    if status.value == "PROCESSING":
        return AsyncOperationStatus.PROCESSING
    if status.value == "DISPATCHED":
        return AsyncOperationStatus.DISPATCHED
    if status.value == "FAILED":
        if attempts >= max_attempts:
            return AsyncOperationStatus.EXHAUSTED
        if next_attempt_at > utc_now_naive():
            return AsyncOperationStatus.RETRYING
        return AsyncOperationStatus.FAILED
    return AsyncOperationStatus.QUEUED


def mail_operation_status(outbox: MailOutbox) -> AsyncOperationStatus:
    if outbox.status == MailOutboxStatus.SENT:
        return AsyncOperationStatus.SUCCEEDED
    if outbox.status == MailOutboxStatus.PROCESSING:
        return AsyncOperationStatus.PROCESSING
    if outbox.status == MailOutboxStatus.DISPATCHED:
        return AsyncOperationStatus.DISPATCHED
    if outbox.status == MailOutboxStatus.PERMANENT_FAILURE:
        return AsyncOperationStatus.PERMANENT_FAILED
    if outbox.status == MailOutboxStatus.EXPIRED:
        return AsyncOperationStatus.EXPIRED
    if outbox.status == MailOutboxStatus.FAILED:
        if outbox.attempt_count >= settings.MAIL_OUTBOX_MAX_ATTEMPTS:
            return AsyncOperationStatus.EXHAUSTED
        return AsyncOperationStatus.RETRYING
    return AsyncOperationStatus.QUEUED


def score_deletion_operation_status(score: Score) -> AsyncOperationStatus:
    if score.cleanup_attempt_count >= settings.SCORE_DELETION_CLEANUP_MAX_ATTEMPTS:
        return AsyncOperationStatus.EXHAUSTED
    if score.cleanup_attempt_count > 0:
        return AsyncOperationStatus.RETRYING
    return AsyncOperationStatus.QUEUED


def matches_operation_filters(
    operation: AsyncOperationRead,
    filters: AsyncOperationFilters,
) -> bool:
    if filters.status is not None and operation.status != filters.status:
        return False
    if filters.error_class is not None and operation.error_class != filters.error_class:
        return False
    if filters.resource_type is not None and operation.resource_type != filters.resource_type:
        return False
    if (
        filters.created_after is not None
        and operation.created_at is not None
        and operation.created_at < filters.created_after
    ):
        return False
    if filters.created_after is not None and operation.created_at is None:
        return False
    if (
        filters.updated_before is not None
        and operation.updated_at is not None
        and operation.updated_at > filters.updated_before
    ):
        return False
    if filters.updated_before is not None and operation.updated_at is None:
        return False
    return True


def stored_error_class(record: object) -> AsyncOperationErrorClass | None:
    error_class = getattr(record, "internal_error_class", None)
    if error_class is None:
        return None
    return AsyncOperationErrorClass(str(error_class))


def stored_diagnostic(record: object) -> AsyncOperationDiagnostic | None:
    internal_code = getattr(record, "internal_error_code", None)
    internal_stage = getattr(record, "internal_error_stage", None)
    internal_error_class = getattr(record, "internal_error_class", None)
    retryable = getattr(record, "internal_error_retryable", None)
    if (
        internal_code is None
        and internal_stage is None
        and internal_error_class is None
        and retryable is None
    ):
        return None
    return AsyncOperationDiagnostic(
        code=internal_code,
        stage=internal_stage,
        retryable=bool(retryable),
    )


def status_counts(counter: Counter[AsyncOperationStatus]) -> list[AsyncOperationStatusCount]:
    return [
        AsyncOperationStatusCount(status=status, count=count)
        for status, count in sorted(counter.items(), key=lambda item: item[0].value)
    ]
