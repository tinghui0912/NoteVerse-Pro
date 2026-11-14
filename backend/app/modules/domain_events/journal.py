"""Append typed facts without owning the caller's transaction."""

from datetime import datetime
from uuid import uuid4

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as postgres_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from sqlalchemy.orm import Session

from app.core.logger import logger
from app.db.models.domain_event import DomainEvent
from app.modules.domain_events.definitions import DomainFact
from app.utils.timezone import utc_now_naive

# The transaction-scoped append gate makes generated IDs commit ordered. A
# sequence alone permits a checkpoint to pass an earlier, uncommitted append.
JOURNAL_APPEND_LOCK = 0x4E56444F4D41494E


def append_fact(db: Session, fact: DomainFact, *, occurred_at: datetime) -> DomainEvent:
    dialect = db.get_bind().dialect.name
    if dialect == "postgresql":
        db.execute(text("SELECT pg_advisory_xact_lock(:key)"), {"key": JOURNAL_APPEND_LOCK})
        insert = postgres_insert
    elif dialect == "sqlite":
        insert = sqlite_insert
    else:
        raise ValueError("Domain journal requires PostgreSQL or SQLite")
    # Round-trip through the definition even if the caller used model_construct.
    fact = type(fact).model_validate(fact.model_dump(mode="json"))
    event_id = db.scalar(
        insert(DomainEvent)
        .values(
            event_uuid=str(uuid4()),
            event_type=fact.event_type,
            schema_version=fact.schema_version,
            aggregate_type=fact.aggregate_type,
            aggregate_id=fact.aggregate_id,
            dedupe_key=fact.dedupe_key,
            payload=fact.model_dump(mode="json"),
            occurred_at=occurred_at,
            recorded_at=utc_now_naive(),
        )
        .on_conflict_do_nothing(index_elements=["dedupe_key"])
        .returning(DomainEvent.id)
    )
    row = (
        db.get(DomainEvent, event_id)
        if event_id is not None
        else db.scalar(select(DomainEvent).where(DomainEvent.dedupe_key == fact.dedupe_key))
    )
    if row is None:
        raise RuntimeError("Journal append did not resolve a fact")
    if (row.event_type, row.aggregate_type, row.aggregate_id) != (
        fact.event_type,
        fact.aggregate_type,
        fact.aggregate_id,
    ):
        raise ValueError("A dedupe key must identify the same semantic fact")
    if event_id is not None:
        logger.bind(
            event="domain_event.recorded",
            event_id=row.id,
            event_type=row.event_type,
            aggregate_type=row.aggregate_type,
            aggregate_id=row.aggregate_id,
            commit_pending=True,
        ).info("domain_event.recorded")
    return row
