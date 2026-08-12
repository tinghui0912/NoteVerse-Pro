from __future__ import annotations

from collections import Counter, defaultdict

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
    outbox_operation_status_sql,
    status_counts,
    summary_predicates,
    summary_result_rows,
)
from app.modules.ops.schemas import (
    AsyncOperationKind,
    AsyncOperationKindSummary,
    AsyncOperationsSummaryRead,
    AsyncOperationStatus,
)


class AsyncOperationSummaryQuery:
    async def summary(
        self,
        db: AsyncSession,
        *,
        kinds: tuple[AsyncOperationKind, ...],
        filters: AsyncOperationFilters,
    ) -> AsyncOperationsSummaryRead:
        rows = await self.summary_rows(db, kinds=kinds, filters=filters)
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

    async def summary_rows(
        self,
        db: AsyncSession,
        *,
        kinds: tuple[AsyncOperationKind, ...],
        filters: AsyncOperationFilters,
    ) -> list[tuple[AsyncOperationKind, AsyncOperationStatus, int]]:
        rows: list[tuple[AsyncOperationKind, AsyncOperationStatus, int]] = []
        for source_kind in kinds:
            rows.extend(await self.summary_rows_for_kind(db, source_kind, filters))
        return rows

    async def summary_rows_for_kind(
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

    @staticmethod
    async def _import_summary_rows(
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

    @staticmethod
    async def _render_summary_rows(
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

    @staticmethod
    async def _playback_summary_rows(
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

    @staticmethod
    async def _mail_summary_rows(
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

    @staticmethod
    async def _score_deletion_summary_rows(
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
