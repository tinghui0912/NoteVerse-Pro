"""Named DB-only projections commit their writes and progress together."""

from collections.abc import Callable, Sequence
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.logger import logger
from app.db.model_utils import require_persisted_id
from app.db.models.domain_event import DomainEvent, DomainProjectionCheckpoint
from app.modules.domain_events.definitions import DomainFact
from app.modules.domain_events.policy import PROJECTION_BATCH_SIZE
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class ProjectionDefinition:
    name: str
    facts: tuple[type[DomainFact], ...]
    handle: Callable[[Session, DomainEvent, DomainFact], None]


def run_projection_batch(
    db: Session, projection: ProjectionDefinition, *, batch_size: int = PROJECTION_BATCH_SIZE
) -> int:
    """Own one bounded transaction; an unsuccessful batch makes no progress."""
    if batch_size < 1:
        raise ValueError("Projection batch size must be positive")
    context: dict[str, int | str | None] = {}
    processed = 0
    try:
        insert = postgres_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
        db.execute(
            insert(DomainProjectionCheckpoint)
            .values(
                projection_name=projection.name,
                last_event_id=0,
                updated_at=utc_now_naive(),
            )
            .on_conflict_do_nothing(index_elements=["projection_name"])
        )
        checkpoint = db.scalar(
            select(DomainProjectionCheckpoint)
            .where(
                DomainProjectionCheckpoint.projection_name == projection.name,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        )
        if checkpoint is None:
            raise RuntimeError("Projection checkpoint is unavailable")
        rows = list(
            db.scalars(
                select(DomainEvent)
                .where(
                    DomainEvent.id > checkpoint.last_event_id,
                )
                .order_by(DomainEvent.id.asc())
                .limit(batch_size)
                .execution_options(populate_existing=True)
            )
        )
        definitions = {(fact.event_type, fact.schema_version): fact for fact in projection.facts}
        handled_types = {fact.event_type for fact in projection.facts}
        for current in rows:
            context = {
                "event_id": current.id,
                "event_type": current.event_type,
                "aggregate_type": current.aggregate_type,
                "aggregate_id": current.aggregate_id,
            }
            if current.event_type in handled_types:
                definition = definitions.get((current.event_type, current.schema_version))
                if definition is None:
                    raise ValueError("Unsupported domain event schema version")
                fact = definition.model_validate(current.payload)
                if (
                    current.aggregate_type != fact.aggregate_type
                    or current.aggregate_id != fact.aggregate_id
                ):
                    raise ValueError("Domain event aggregate identity mismatch")
                projection.handle(db, current, fact)
                processed += 1
            checkpoint.last_event_id = require_persisted_id(current.id, entity="domain event")
        if rows:
            checkpoint.updated_at = utc_now_naive()
        last_event_id = checkpoint.last_event_id
        db.commit()
        logger.bind(
            event="domain_projection.completed",
            projection_name=projection.name,
            processed_count=processed,
            scanned_count=len(rows),
            last_event_id=last_event_id,
        ).info("domain_projection.completed")
        return processed
    except Exception as exc:
        # Do not log validation exceptions or payloads: they may contain values.
        db.rollback()
        logger.bind(
            event="domain_projection.failed",
            projection_name=projection.name,
            error_class=type(exc).__name__,
            processed_count=processed,
            **context,
        ).error("domain_projection.failed")
        raise


def run_projections(db: Session, projections: Sequence[ProjectionDefinition]) -> int:
    """A blocked projection does not prevent other checkpoints from progressing."""
    failures: list[Exception] = []
    processed = 0
    for projection in projections:
        try:
            processed += run_projection_batch(db, projection)
        except Exception:
            # Scheduler exception logging must not expand a validation error's
            # input values. Detailed, payload-free context is logged by the batch.
            failures.append(RuntimeError(f"Projection {projection.name} requires retry"))
    if failures:
        raise ExceptionGroup("Database projections require retry", failures)
    return processed
