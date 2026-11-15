from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlmodel import col

from app.db.models import (
    ImportJob,
    ImportDispatch,
    MailOutbox,
    PlaybackOutbox,
    RenderOutbox,
    ScoreDeletionOperation,
)
from app.modules.ops.operation_filters import AsyncOperationFilters
from app.modules.ops.operation_projection import (
    matches_operation_filters,
    import_operation_updated_at_sql,
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

    def list_operations(
        self,
        db: Session,
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
            operations.extend(self._operations_for_kind(db, source_kind, limit=source_limit))
        operations = [
            operation for operation in operations if matches_operation_filters(operation, filters)
        ]
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

    def summary(
        self,
        db: Session,
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
        return self.summary_query.summary(
            db,
            kinds=selected_query_operation_kinds(kind),
            filters=filters,
        )

    def _import_operations(
        self,
        db: Session,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            db.execute(
                select(ImportJob, ImportDispatch)
                .join(ImportDispatch, ImportDispatch.job_id == ImportJob.id)
                .order_by(import_operation_updated_at_sql().desc())
                .limit(limit)
            )
        ).all()
        return [read_import_operation(job, dispatch) for job, dispatch in rows]

    def _operations_for_kind(
        self,
        db: Session,
        kind: AsyncOperationKind,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        if kind == AsyncOperationKind.IMPORT:
            return self._import_operations(db, limit=limit)
        if kind == AsyncOperationKind.RENDER:
            return self._render_operations(db, limit=limit)
        if kind == AsyncOperationKind.PLAYBACK:
            return self._playback_operations(db, limit=limit)
        if kind == AsyncOperationKind.MAIL:
            return self._mail_operations(db, limit=limit)
        if kind == AsyncOperationKind.SCORE_DELETION:
            return self._score_deletion_operations(db, limit=limit)
        raise AssertionError(f"unsupported async operation kind: {kind}")

    def _render_operations(
        self,
        db: Session,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            db.execute(
                select(RenderOutbox).order_by(col(RenderOutbox.updated_at).desc()).limit(limit)
            )
        ).scalars()
        return [read_render_operation(outbox) for outbox in rows]

    def _playback_operations(
        self,
        db: Session,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            db.execute(
                select(PlaybackOutbox).order_by(col(PlaybackOutbox.updated_at).desc()).limit(limit)
            )
        ).scalars()
        return [read_playback_operation(outbox) for outbox in rows]

    def _mail_operations(
        self,
        db: Session,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            db.execute(select(MailOutbox).order_by(col(MailOutbox.updated_at).desc()).limit(limit))
        ).scalars()
        return [read_mail_operation(outbox) for outbox in rows]

    def _score_deletion_operations(
        self,
        db: Session,
        *,
        limit: int,
    ) -> list[AsyncOperationRead]:
        rows = (
            db.execute(
                select(ScoreDeletionOperation)
                .order_by(col(ScoreDeletionOperation.updated_at).desc())
                .limit(limit)
            )
        ).scalars()
        return [read_score_deletion_operation(operation) for operation in rows]


ops_async_operation_query_service = OpsAsyncOperationQueryService()
