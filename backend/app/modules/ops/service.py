from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import dataclass
from datetime import datetime

from sqlalchemy import case, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import settings
from app.core.exceptions import ResourceNotFoundException, ValidationException
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
    ScoreDeletionStatus,
)
from app.modules.async_operations.diagnostics import clear_async_diagnostic
from app.modules.ops.operation_filters import AsyncOperationFilters
from app.modules.ops.operation_projection import (
    import_operation_status,
    mail_operation_status,
    matches_operation_filters,
    outbox_operation_status_sql,
    read_import_operation,
    read_mail_operation,
    read_playback_operation,
    read_render_operation,
    read_score_deletion_operation,
    status_counts,
    summary_predicates,
    summary_result_rows,
)
from app.modules.ops.schemas import (
    AsyncOperationErrorClass,
    AsyncOperationKind,
    AsyncOperationKindSummary,
    AsyncOperationRead,
    AsyncOperationsSummaryRead,
    AsyncOperationStatus,
)
from app.shared.pagination import OffsetPage
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class RetryOperationResult:
    operation: AsyncOperationRead
    previous_state: str


class OpsAsyncOperationService:
    async def list_operations(
        self,
        db: AsyncSession,
        *,
        limit: int,
        offset: int = 0,
        kind: AsyncOperationKind | None = None,
        status: AsyncOperationStatus | None = None,
        error_class: AsyncOperationErrorClass | None = None,
        resource_type: str | None = None,
        created_after: datetime | None = None,
        updated_before: datetime | None = None,
    ) -> OffsetPage[AsyncOperationRead]:
        filters = AsyncOperationFilters(
            status=status,
            error_class=error_class,
            resource_type=resource_type,
            created_after=created_after,
            updated_before=updated_before,
        )
        source_limit = 5000 if filters.has_filters else offset + limit + 1
        operations: list[AsyncOperationRead] = []
        if kind in {None, AsyncOperationKind.IMPORT}:
            operations.extend(await self._import_operations(db, limit=source_limit))
        if kind in {None, AsyncOperationKind.RENDER}:
            operations.extend(await self._render_operations(db, limit=source_limit))
        if kind in {None, AsyncOperationKind.PLAYBACK}:
            operations.extend(await self._playback_operations(db, limit=source_limit))
        if kind in {None, AsyncOperationKind.MAIL}:
            operations.extend(await self._mail_operations(db, limit=source_limit))
        if kind in {None, AsyncOperationKind.SCORE_DELETION}:
            operations.extend(await self._score_deletion_operations(db, limit=source_limit))
        operations = [operation for operation in operations if matches_operation_filters(operation, filters)]
        sorted_operations = sorted(
            operations,
            key=lambda operation: operation.updated_at or operation.created_at or datetime.min,
            reverse=True,
        )
        page_items = sorted_operations[offset : offset + limit]
        return OffsetPage(
            items=page_items,
            limit=limit,
            offset=offset,
            has_more=len(sorted_operations) > offset + limit,
        )

    async def summary(
        self,
        db: AsyncSession,
        *,
        kind: AsyncOperationKind | None = None,
        status: AsyncOperationStatus | None = None,
        error_class: AsyncOperationErrorClass | None = None,
        resource_type: str | None = None,
        created_after: datetime | None = None,
        updated_before: datetime | None = None,
    ) -> AsyncOperationsSummaryRead:
        filters = AsyncOperationFilters(
            status=status,
            error_class=error_class,
            resource_type=resource_type,
            created_after=created_after,
            updated_before=updated_before,
        )
        rows = await self._summary_rows(db, kind=kind, filters=filters)
        total_statuses: Counter[AsyncOperationStatus] = Counter()
        kind_statuses: dict[AsyncOperationKind, Counter[AsyncOperationStatus]] = defaultdict(Counter)
        total = 0
        for row_kind, row_status, count in rows:
            total += count
            total_statuses[row_status] += count
            kind_statuses[row_kind][row_status] += count
        return AsyncOperationsSummaryRead(
            total=total,
            statuses=status_counts(total_statuses),
            kinds=[
                AsyncOperationKindSummary(
                    kind=kind,
                    total=sum(counter.values()),
                    statuses=status_counts(counter),
                )
                for kind, counter in sorted(kind_statuses.items(), key=lambda item: item[0].value)
            ],
        )

    async def retry_operation(
        self,
        db: AsyncSession,
        *,
        kind: AsyncOperationKind,
        operation_id: str,
    ) -> RetryOperationResult:
        if kind == AsyncOperationKind.IMPORT:
            return await self._retry_import(db, operation_id)
        if kind == AsyncOperationKind.RENDER:
            return await self._retry_render(db, operation_id)
        if kind == AsyncOperationKind.PLAYBACK:
            return await self._retry_playback(db, operation_id)
        if kind == AsyncOperationKind.MAIL:
            return await self._retry_mail(db, operation_id)
        if kind == AsyncOperationKind.SCORE_DELETION:
            return await self._retry_score_deletion(db, operation_id)
        raise ValidationException(code=ErrorCode.VALIDATION_ERROR, field="kind")

    async def _summary_rows(
        self,
        db: AsyncSession,
        *,
        kind: AsyncOperationKind | None,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        rows: list[tuple[AsyncOperationKind, AsyncOperationStatus, int]] = []
        if kind in {None, AsyncOperationKind.IMPORT}:
            rows.extend(await self._import_summary_rows(db, filters))
        if kind in {None, AsyncOperationKind.RENDER}:
            rows.extend(await self._render_summary_rows(db, filters))
        if kind in {None, AsyncOperationKind.PLAYBACK}:
            rows.extend(await self._playback_summary_rows(db, filters))
        if kind in {None, AsyncOperationKind.MAIL}:
            rows.extend(await self._mail_summary_rows(db, filters))
        if kind in {None, AsyncOperationKind.SCORE_DELETION}:
            rows.extend(await self._score_deletion_summary_rows(db, filters))
        return rows

    async def _import_summary_rows(
        self,
        db: AsyncSession,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        status_expr = case(
            (
                col(ImportJob.state).in_([ImportJobState.PENDING_REVIEW, ImportJobState.CONFIRMED]),
                AsyncOperationStatus.SUCCEEDED.value,
            ),
            (
                (ImportJob.state == ImportJobState.RUNNING)
                | (ImportJob.dispatch_status == ImportDispatchStatus.PROCESSING),
                AsyncOperationStatus.PROCESSING.value,
            ),
            (
                ImportJob.dispatch_status == ImportDispatchStatus.DISPATCHED,
                AsyncOperationStatus.DISPATCHED.value,
            ),
            (
                (ImportJob.state == ImportJobState.FAILURE)
                & (ImportJob.dispatch_attempt_count >= settings.IMPORT_DISPATCH_MAX_ATTEMPTS),
                AsyncOperationStatus.EXHAUSTED.value,
            ),
            (ImportJob.state == ImportJobState.FAILURE, AsyncOperationStatus.FAILED.value),
            (
                ImportJob.dispatch_status == ImportDispatchStatus.FAILED,
                AsyncOperationStatus.RETRYING.value,
            ),
            else_=AsyncOperationStatus.QUEUED.value,
        )
        predicates = summary_predicates(
            filters,
            status_expr=status_expr,
            error_class_expr=ImportJob.internal_error_class,
            resource_type_expr=literal("import_job"),
            created_at_expr=ImportJob.created_at,
            updated_at_expr=ImportJob.updated_at,
        )
        result = await db.execute(
            select(status_expr.label("status"), func.count())
            .select_from(ImportJob)
            .where(*predicates)
            .group_by(status_expr)
        )
        return summary_result_rows(AsyncOperationKind.IMPORT, result.all())

    async def _render_summary_rows(
        self,
        db: AsyncSession,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        status_expr = outbox_operation_status_sql(
            RenderOutbox.status,
            RenderOutbox.attempt_count,
            settings.RENDER_OUTBOX_MAX_ATTEMPTS,
            RenderOutbox.next_attempt_at,
        )
        predicates = summary_predicates(
            filters,
            status_expr=status_expr,
            error_class_expr=RenderOutbox.internal_error_class,
            resource_type_expr=func.lower(RenderOutbox.target_type),
            created_at_expr=RenderOutbox.created_at,
            updated_at_expr=RenderOutbox.updated_at,
        )
        result = await db.execute(
            select(status_expr.label("status"), func.count())
            .select_from(RenderOutbox)
            .where(*predicates)
            .group_by(status_expr)
        )
        return summary_result_rows(AsyncOperationKind.RENDER, result.all())

    async def _playback_summary_rows(
        self,
        db: AsyncSession,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        status_expr = outbox_operation_status_sql(
            PlaybackOutbox.status,
            PlaybackOutbox.attempt_count,
            settings.PLAYBACK_OUTBOX_MAX_ATTEMPTS,
            PlaybackOutbox.next_attempt_at,
        )
        predicates = summary_predicates(
            filters,
            status_expr=status_expr,
            error_class_expr=PlaybackOutbox.internal_error_class,
            resource_type_expr=func.lower(PlaybackOutbox.asset_kind),
            created_at_expr=PlaybackOutbox.created_at,
            updated_at_expr=PlaybackOutbox.updated_at,
        )
        result = await db.execute(
            select(status_expr.label("status"), func.count())
            .select_from(PlaybackOutbox)
            .where(*predicates)
            .group_by(status_expr)
        )
        return summary_result_rows(AsyncOperationKind.PLAYBACK, result.all())

    async def _mail_summary_rows(
        self,
        db: AsyncSession,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        status_expr = case(
            (MailOutbox.status == MailOutboxStatus.SENT, AsyncOperationStatus.SUCCEEDED.value),
            (MailOutbox.status == MailOutboxStatus.PROCESSING, AsyncOperationStatus.PROCESSING.value),
            (MailOutbox.status == MailOutboxStatus.DISPATCHED, AsyncOperationStatus.DISPATCHED.value),
            (
                MailOutbox.status == MailOutboxStatus.PERMANENT_FAILURE,
                AsyncOperationStatus.PERMANENT_FAILED.value,
            ),
            (MailOutbox.status == MailOutboxStatus.EXPIRED, AsyncOperationStatus.EXPIRED.value),
            (
                (MailOutbox.status == MailOutboxStatus.FAILED)
                & (MailOutbox.attempt_count >= settings.MAIL_OUTBOX_MAX_ATTEMPTS),
                AsyncOperationStatus.EXHAUSTED.value,
            ),
            (MailOutbox.status == MailOutboxStatus.FAILED, AsyncOperationStatus.RETRYING.value),
            else_=AsyncOperationStatus.QUEUED.value,
        )
        predicates = summary_predicates(
            filters,
            status_expr=status_expr,
            error_class_expr=MailOutbox.internal_error_class,
            resource_type_expr=MailOutbox.category,
            created_at_expr=MailOutbox.created_at,
            updated_at_expr=MailOutbox.updated_at,
        )
        result = await db.execute(
            select(status_expr.label("status"), func.count())
            .select_from(MailOutbox)
            .where(*predicates)
            .group_by(status_expr)
        )
        return summary_result_rows(AsyncOperationKind.MAIL, result.all())

    async def _score_deletion_summary_rows(
        self,
        db: AsyncSession,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        status_expr = case(
            (
                Score.cleanup_attempt_count >= settings.SCORE_DELETION_CLEANUP_MAX_ATTEMPTS,
                AsyncOperationStatus.EXHAUSTED.value,
            ),
            (Score.cleanup_attempt_count > 0, AsyncOperationStatus.RETRYING.value),
            else_=AsyncOperationStatus.QUEUED.value,
        )
        created_at_expr = func.coalesce(Score.deletion_requested_at, Score.deleted_at)
        predicates = [
            Score.deletion_status == ScoreDeletionStatus.DELETING,
            *summary_predicates(
                filters,
                status_expr=status_expr,
                error_class_expr=Score.internal_error_class,
                resource_type_expr=literal("score"),
                created_at_expr=created_at_expr,
                updated_at_expr=Score.updated_at,
            ),
        ]
        result = await db.execute(
            select(status_expr.label("status"), func.count())
            .select_from(Score)
            .where(*predicates)
            .group_by(status_expr)
        )
        return summary_result_rows(AsyncOperationKind.SCORE_DELETION, result.all())

    async def _import_operations(
        self,
        db: AsyncSession,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            await db.execute(select(ImportJob).order_by(col(ImportJob.updated_at).desc()).limit(limit))
        ).scalars()
        return [read_import_operation(job) for job in rows]

    async def _render_operations(
        self,
        db: AsyncSession,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            await db.execute(
                select(RenderOutbox).order_by(col(RenderOutbox.updated_at).desc()).limit(limit)
            )
        ).scalars()
        return [read_render_operation(outbox) for outbox in rows]

    async def _playback_operations(
        self,
        db: AsyncSession,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            await db.execute(
                select(PlaybackOutbox).order_by(col(PlaybackOutbox.updated_at).desc()).limit(limit)
            )
        ).scalars()
        return [read_playback_operation(outbox) for outbox in rows]

    async def _mail_operations(
        self,
        db: AsyncSession,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            await db.execute(select(MailOutbox).order_by(col(MailOutbox.updated_at).desc()).limit(limit))
        ).scalars()
        return [read_mail_operation(outbox) for outbox in rows]

    async def _score_deletion_operations(
        self,
        db: AsyncSession,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            await db.execute(
                select(Score)
                .where(Score.deletion_status == ScoreDeletionStatus.DELETING)
                .order_by(col(Score.updated_at).desc())
                .limit(limit)
            )
        ).scalars()
        return [read_score_deletion_operation(score) for score in rows]

    async def _retry_import(self, db: AsyncSession, operation_id: str) -> RetryOperationResult:
        job = (
            await db.execute(
                select(ImportJob).where(ImportJob.job_uuid == operation_id).with_for_update()
            )
        ).scalar_one_or_none()
        if job is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        previous_state = f"{job.state.value}/{job.dispatch_status.value}"
        if job.state in {ImportJobState.RUNNING, ImportJobState.PENDING_REVIEW, ImportJobState.CONFIRMED}:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": import_operation_status(job).value},
            )
        now = utc_now_naive()
        job.state = ImportJobState.PENDING
        job.progress = 0
        job.current_step = None
        job.dispatch_status = ImportDispatchStatus.PENDING
        job.dispatch_attempt_count = 0
        job.publish_attempt_count = 0
        job.next_dispatch_at = now
        job.dispatched_at = None
        job.dispatch_started_at = None
        job.dispatch_completed_at = None
        job.dispatch_error = None
        clear_async_diagnostic(job)
        job.error = None
        job.error_type = None
        job.started_at = None
        job.finished_at = None
        job.updated_at = now
        await db.commit()
        await db.refresh(job)
        return RetryOperationResult(operation=read_import_operation(job), previous_state=previous_state)

    async def _retry_render(self, db: AsyncSession, operation_id: str) -> RetryOperationResult:
        outbox = (
            await db.execute(
                select(RenderOutbox).where(RenderOutbox.outbox_uuid == operation_id).with_for_update()
            )
        ).scalar_one_or_none()
        if outbox is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        previous_state = outbox.status.value
        if outbox.status in {
            RenderOutboxStatus.PROCESSING,
            RenderOutboxStatus.DISPATCHED,
            RenderOutboxStatus.COMPLETED,
        }:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": read_render_operation(outbox).status.value},
            )
        now = utc_now_naive()
        outbox.status = RenderOutboxStatus.PENDING
        outbox.attempt_count = 0
        outbox.next_attempt_at = now
        outbox.dispatched_at = None
        outbox.started_at = None
        outbox.completed_at = None
        outbox.last_error = None
        clear_async_diagnostic(outbox)
        outbox.updated_at = now
        await db.commit()
        await db.refresh(outbox)
        return RetryOperationResult(operation=read_render_operation(outbox), previous_state=previous_state)

    async def _retry_playback(self, db: AsyncSession, operation_id: str) -> RetryOperationResult:
        outbox = (
            await db.execute(
                select(PlaybackOutbox)
                .where(PlaybackOutbox.outbox_uuid == operation_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if outbox is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        previous_state = outbox.status.value
        if outbox.status in {
            PlaybackOutboxStatus.PROCESSING,
            PlaybackOutboxStatus.DISPATCHED,
            PlaybackOutboxStatus.COMPLETED,
        }:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": read_playback_operation(outbox).status.value},
            )
        now = utc_now_naive()
        outbox.status = PlaybackOutboxStatus.PENDING
        outbox.attempt_count = 0
        outbox.next_attempt_at = now
        outbox.dispatched_at = None
        outbox.started_at = None
        outbox.completed_at = None
        outbox.last_error = None
        clear_async_diagnostic(outbox)
        outbox.updated_at = now
        await db.commit()
        await db.refresh(outbox)
        return RetryOperationResult(operation=read_playback_operation(outbox), previous_state=previous_state)

    async def _retry_mail(self, db: AsyncSession, operation_id: str) -> RetryOperationResult:
        outbox = (
            await db.execute(
                select(MailOutbox).where(MailOutbox.outbox_uuid == operation_id).with_for_update()
            )
        ).scalar_one_or_none()
        if outbox is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        previous_state = outbox.status.value
        if outbox.status in {
            MailOutboxStatus.PROCESSING,
            MailOutboxStatus.DISPATCHED,
            MailOutboxStatus.SENT,
            MailOutboxStatus.PERMANENT_FAILURE,
            MailOutboxStatus.EXPIRED,
        }:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": mail_operation_status(outbox).value},
            )
        if not outbox.text_body:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="body",
                details={"reason": "mail_body_unavailable"},
            )
        now = utc_now_naive()
        outbox.status = MailOutboxStatus.PENDING
        outbox.attempt_count = 0
        outbox.next_attempt_at = now
        outbox.dispatched_at = None
        outbox.started_at = None
        outbox.completed_at = None
        outbox.last_error = None
        clear_async_diagnostic(outbox)
        outbox.updated_at = now
        await db.commit()
        await db.refresh(outbox)
        return RetryOperationResult(operation=read_mail_operation(outbox), previous_state=previous_state)

    async def _retry_score_deletion(self, db: AsyncSession, operation_id: str) -> RetryOperationResult:
        score = (
            await db.execute(
                select(Score).where(Score.score_uuid == operation_id).with_for_update()
            )
        ).scalar_one_or_none()
        if score is None:
            raise ResourceNotFoundException("async_operation", operation_id)
        previous_state = score.deletion_status.value
        if score.deletion_status != ScoreDeletionStatus.DELETING:
            raise ValidationException(
                code=ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": score.deletion_status.value},
            )
        now = utc_now_naive()
        score.cleanup_attempt_count = 0
        score.next_cleanup_at = now
        score.deletion_error = None
        clear_async_diagnostic(score)
        score.updated_at = now
        await db.commit()
        await db.refresh(score)
        return RetryOperationResult(
            operation=read_score_deletion_operation(score),
            previous_state=previous_state,
        )

ops_async_operation_service = OpsAsyncOperationService()
