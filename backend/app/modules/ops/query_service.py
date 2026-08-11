from __future__ import annotations

from collections import Counter, defaultdict
from datetime import datetime

from sqlalchemy import case, func, literal, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.config import settings
from app.db.models import (
    ImportDispatchStatus,
    ImportJob,
    ImportJobState,
    MailOutbox,
    MailOutboxStatus,
    PlaybackOutbox,
    RenderOutbox,
    Score,
    ScoreDeletionStatus,
)
from app.modules.ops.operation_filters import AsyncOperationFilters
from app.modules.ops.operation_projection import (
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


QUERY_OPERATION_KIND_ORDER = (
    AsyncOperationKind.IMPORT,
    AsyncOperationKind.RENDER,
    AsyncOperationKind.PLAYBACK,
    AsyncOperationKind.MAIL,
    AsyncOperationKind.SCORE_DELETION,
)


def selected_query_operation_kinds(
    kind: AsyncOperationKind | None,
) -> tuple[AsyncOperationKind, ...]:
    if kind is None:
        return QUERY_OPERATION_KIND_ORDER
    return (kind,)


class OpsAsyncOperationQueryService:
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
        for source_kind in selected_query_operation_kinds(kind):
            operations.extend(await self._operations_for_kind(db, source_kind, limit=source_limit))
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

    async def _summary_rows(
        self,
        db: AsyncSession,
        *,
        kind: AsyncOperationKind | None,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        rows: list[tuple[AsyncOperationKind, AsyncOperationStatus, int]] = []
        for source_kind in selected_query_operation_kinds(kind):
            rows.extend(await self._summary_rows_for_kind(db, source_kind, filters))
        return rows

    async def _summary_rows_for_kind(
        self,
        db: AsyncSession,
        kind: AsyncOperationKind,
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        if kind == AsyncOperationKind.IMPORT:
            return await self._import_summary_rows(db, filters)
        if kind == AsyncOperationKind.RENDER:
            return await self._render_summary_rows(db, filters)
        if kind == AsyncOperationKind.PLAYBACK:
            return await self._playback_summary_rows(db, filters)
        if kind == AsyncOperationKind.MAIL:
            return await self._mail_summary_rows(db, filters)
        if kind == AsyncOperationKind.SCORE_DELETION:
            return await self._score_deletion_summary_rows(db, filters)
        raise AssertionError(f"unsupported async operation kind: {kind}")

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

    async def _operations_for_kind(
        self,
        db: AsyncSession,
        kind: AsyncOperationKind,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        if kind == AsyncOperationKind.IMPORT:
            return await self._import_operations(db, limit=limit)
        if kind == AsyncOperationKind.RENDER:
            return await self._render_operations(db, limit=limit)
        if kind == AsyncOperationKind.PLAYBACK:
            return await self._playback_operations(db, limit=limit)
        if kind == AsyncOperationKind.MAIL:
            return await self._mail_operations(db, limit=limit)
        if kind == AsyncOperationKind.SCORE_DELETION:
            return await self._score_deletion_operations(db, limit=limit)
        raise AssertionError(f"unsupported async operation kind: {kind}")

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


ops_async_operation_query_service = OpsAsyncOperationQueryService()
