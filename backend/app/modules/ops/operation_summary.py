from collections import Counter, defaultdict
from sqlalchemy import func, select
from sqlalchemy.orm import Session
from app.modules.ops.operation_filters import AsyncOperationFilters
from app.modules.ops.operation_projection import operation_projection, projection_predicates
from app.modules.ops.schemas import (
    AsyncOperationKind,
    AsyncOperationKindSummary,
    AsyncOperationStatus,
    AsyncOperationStatusCount,
    AsyncOperationsSummaryRead,
)


def status_counts(counter):
    return [
        AsyncOperationStatusCount(status=status, count=count)
        for status, count in sorted(counter.items())
    ]


class AsyncOperationSummaryQuery:
    def summary(
        self, db: Session, *, kinds: tuple[AsyncOperationKind, ...], filters: AsyncOperationFilters
    ) -> AsyncOperationsSummaryRead:
        projection = operation_projection()
        c = projection.c
        rows = db.execute(
            select(c.kind, c.status, func.count())
            .where(*projection_predicates(c, filters, kinds=kinds))
            .group_by(c.kind, c.status)
        ).all()
        total_statuses: Counter[AsyncOperationStatus] = Counter()
        kind_statuses: dict[AsyncOperationKind, Counter[AsyncOperationStatus]] = defaultdict(
            Counter
        )
        for kind, status, count in rows:
            total_statuses[AsyncOperationStatus(status)] += count
            kind_statuses[AsyncOperationKind(kind)][AsyncOperationStatus(status)] += count
        return AsyncOperationsSummaryRead(
            total=sum(total_statuses.values()),
            statuses=status_counts(total_statuses),
            kinds=[
                AsyncOperationKindSummary(
                    kind=kind, total=sum(counter.values()), statuses=status_counts(counter)
                )
                for kind, counter in sorted(kind_statuses.items())
            ],
        )
