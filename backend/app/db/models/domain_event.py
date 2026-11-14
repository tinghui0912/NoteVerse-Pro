"""Committed business facts and independent database projection progress."""

from datetime import datetime
from typing import Any
from uuid import uuid4

from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    DDL,
    Index,
    Integer,
    JSON,
    String,
    event,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive


class DomainEvent(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "domain_events"
    __table_args__ = (
        CheckConstraint("schema_version >= 1", name="ck_domain_events_schema_version"),
        Index("idx_domain_events_type_id", "event_type", "id"),
        Index("idx_domain_events_aggregate_id", "aggregate_type", "aggregate_id", "id"),
    )

    id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
        ),
    )
    event_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), nullable=False, unique=True),
    )
    event_type: str = Field(sa_column=Column(String(96), nullable=False))
    schema_version: int = Field(sa_column=Column(Integer, nullable=False))
    aggregate_type: str = Field(sa_column=Column(String(64), nullable=False))
    aggregate_id: str = Field(sa_column=Column(String(128), nullable=False))
    dedupe_key: str = Field(sa_column=Column(String(256), nullable=False, unique=True))
    payload: dict[str, Any] = Field(
        sa_column=Column(JSON().with_variant(JSONB, "postgresql"), nullable=False)
    )
    occurred_at: datetime = Field(sa_column=Column(DateTime, nullable=False))
    recorded_at: datetime = Field(
        default_factory=utc_now_naive, sa_column=Column(DateTime, nullable=False)
    )


class DomainProjectionCheckpoint(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "domain_projection_checkpoints"
    __table_args__ = (
        CheckConstraint("last_event_id >= 0", name="ck_domain_projection_checkpoint_progress"),
    )

    projection_name: str = Field(sa_column=Column(String(96), primary_key=True))
    last_event_id: int = Field(default=0, sa_column=Column(BigInteger, nullable=False))
    updated_at: datetime = Field(
        default_factory=utc_now_naive, sa_column=Column(DateTime, nullable=False)
    )


@event.listens_for(DomainEvent, "before_update")
@event.listens_for(DomainEvent, "before_delete")
def immutable_domain_fact(mapper, connection, target) -> None:
    raise ValueError("Domain journal facts are append-only")


event.listen(
    DomainEvent.__table__,
    "after_create",
    DDL("""
    CREATE FUNCTION reject_domain_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'Domain journal facts are append-only'; END;
    $$;
    CREATE TRIGGER domain_events_append_only BEFORE UPDATE OR DELETE ON domain_events
    FOR EACH ROW EXECUTE FUNCTION reject_domain_event_mutation();
""").execute_if(dialect="postgresql"),
)
event.listen(
    DomainEvent.__table__,
    "after_drop",
    DDL("DROP FUNCTION reject_domain_event_mutation()").execute_if(dialect="postgresql"),
)
