from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    JSON,
    CheckConstraint,
)
from sqlmodel import Field, SQLModel

from app.shared.time import utc_now

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class OpsAuditEvent(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "ops_audit_events"
    __table_args__ = (
        CheckConstraint(
            "length(btrim(reason)) BETWEEN 3 AND 500 AND reason=btrim(reason)",
            name="ck_ops_audit_reason",
        ),
        Index("idx_ops_audit_events_actor_created", "actor_operator_id", "created_at"),
        Index("idx_ops_audit_events_operation", "target_type", "target_id"),
        Index("idx_ops_audit_events_action_created", "action", "created_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    event_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    actor_operator_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("operators.id", ondelete="SET NULL")),
    )
    action: str = Field(sa_column=Column(String(64), nullable=False))
    target_type: str = Field(sa_column=Column(String(40), nullable=False))
    target_id: str = Field(sa_column=Column(String(128), nullable=False))
    outcome: str = Field(sa_column=Column(String(32), nullable=False))
    error_code: Optional[str] = Field(default=None, sa_column=Column(String(80)))
    reason: str = Field(sa_column=Column(String(500), nullable=False))
    request_id: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    user_agent: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    ip_address: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    previous_state: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    new_state: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    metadata_json: dict = Field(default_factory=dict, sa_column=Column(JSON, nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), default=utc_now, nullable=False),
    )
