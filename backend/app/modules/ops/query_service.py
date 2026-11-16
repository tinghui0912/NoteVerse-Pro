from __future__ import annotations

from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.core.control_plane_errors import ControlPlaneErrorCode
from app.core.exceptions import ResourceNotFoundException
from app.modules.durable_work.failure import DurableFailureClass
from app.modules.ops.operation_filters import AsyncOperationFilters
from app.modules.ops.operation_projection import operation_projection, projection_predicates
from app.modules.ops.operation_summary import AsyncOperationSummaryQuery
from app.modules.ops.schemas import (
    AsyncOperationFailure,
    AsyncOperationKind,
    AsyncOperationRead,
    AsyncOperationsSummaryRead,
    AsyncOperationStatus,
)
from app.shared.pagination import OffsetPage

QUERY_OPERATION_KIND_ORDER = tuple(AsyncOperationKind)


def selected_query_operation_kinds(
    kind: AsyncOperationKind | None,
) -> tuple[AsyncOperationKind, ...]:
    return (kind,) if kind is not None else QUERY_OPERATION_KIND_ORDER


def read_projected_operation(row) -> AsyncOperationRead:
    facts = dict(row)
    failure = None
    if facts["failure_code"] is not None:
        failure = AsyncOperationFailure(
            code=facts["failure_code"],
            stage=facts["failure_stage"],
            classification=facts["failure_class"],
            retryable=facts["failure_retryable"],
            detail=facts["failure_detail"],
        )
    return AsyncOperationRead(
        **{
            key: value
            for key, value in facts.items()
            if key in AsyncOperationRead.model_fields and key != "failure"
        },
        failure=failure,
    )


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
        failure_class: DurableFailureClass | None = None,
        resource_type: str | None = None,
        created_after: datetime | None = None,
        updated_before: datetime | None = None,
    ) -> OffsetPage[AsyncOperationRead]:
        filters = AsyncOperationFilters(
            status, failure_class, resource_type, created_after, updated_before
        )
        projection = operation_projection()
        c = projection.c
        rows = (
            db.execute(
                select(projection)
                .where(
                    *projection_predicates(c, filters, kinds=selected_query_operation_kinds(kind))
                )
                .order_by(c.updated_at.desc(), c.kind, c.operation_id)
                .offset(offset)
                .limit(limit + 1)
            )
            .mappings()
            .all()
        )
        return OffsetPage(
            items=[read_projected_operation(row) for row in rows[:limit]],
            limit=limit,
            offset=offset,
            has_more=len(rows) > limit,
        )

    def get_operation(
        self, db: Session, *, kind: AsyncOperationKind, operation_id: str
    ) -> AsyncOperationRead:
        projection = operation_projection()
        row = (
            db.execute(
                select(projection).where(
                    projection.c.kind == kind.value, projection.c.operation_id == operation_id
                )
            )
            .mappings()
            .one_or_none()
        )
        if row is None:
            raise ResourceNotFoundException(
                "async_operation", operation_id, code=ControlPlaneErrorCode.RESOURCE_NOT_FOUND
            )
        return read_projected_operation(row)

    def summary(
        self,
        db: Session,
        *,
        kind: AsyncOperationKind | None = None,
        status: AsyncOperationStatus | None = None,
        failure_class: DurableFailureClass | None = None,
        resource_type: str | None = None,
        created_after: datetime | None = None,
        updated_before: datetime | None = None,
    ) -> AsyncOperationsSummaryRead:
        return self.summary_query.summary(
            db,
            kinds=selected_query_operation_kinds(kind),
            filters=AsyncOperationFilters(
                status, failure_class, resource_type, created_after, updated_before
            ),
        )


ops_async_operation_query_service = OpsAsyncOperationQueryService()
