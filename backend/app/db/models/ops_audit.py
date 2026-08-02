from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, String
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class OpsAuditEvent(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "ops_audit_events"
    __table_args__ = (
        Index("idx_ops_audit_events_actor_created", "actor_user_id", "created_at"),
        Index("idx_ops_audit_events_operation", "operation_kind", "operation_id"),
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
    actor_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL")),
    )
    action: str = Field(sa_column=Column(String(64), nullable=False))
    operation_kind: str = Field(sa_column=Column(String(40), nullable=False))
    operation_id: str = Field(sa_column=Column(String(128), nullable=False))
    outcome: str = Field(sa_column=Column(String(32), nullable=False))
    error_code: Optional[str] = Field(default=None, sa_column=Column(String(80)))
    reason: Optional[str] = Field(default=None, sa_column=Column(String(500)))
    request_id: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    peer_address: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    previous_state: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    new_state: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
