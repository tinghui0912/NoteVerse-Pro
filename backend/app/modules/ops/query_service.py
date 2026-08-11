from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.db.models import (
    ImportJob,
    MailOutbox,
    PlaybackOutbox,
    RenderOutbox,
    Score,
    ScoreDeletionStatus,
)
from app.modules.ops.operation_filters import AsyncOperationFilters
from app.modules.ops.operation_projection import (
    matches_operation_filters,
    read_import_operation,
    read_mail_operation,
    read_playback_operation,
    read_render_operation,
    read_score_deletion_operation,
)
from app.modules.ops.operation_summary import AsyncOperationSummaryQuery
from app.modules.ops.schemas import (
    AsyncOperationErrorClass,
    AsyncOperationKind,
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
    def __init__(self, summary_query: AsyncOperationSummaryQuery | None = None) -> None:
        self.summary_query = summary_query or AsyncOperationSummaryQuery()

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
        return await self.summary_query.summary(
            db,
            kinds=selected_query_operation_kinds(kind),
            filters=filters,
        )

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
