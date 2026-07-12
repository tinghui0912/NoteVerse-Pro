from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, JSON, String
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive


bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class RealtimeEvent(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "realtime_events"
    __table_args__ = (
        Index("idx_realtime_events_recipient_id", "recipient_user_id", "id"),
        Index("idx_realtime_events_recipient_created", "recipient_user_id", "created_at"),
        Index("idx_realtime_events_type", "type"),
        Index("idx_realtime_events_score", "score_id"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    event_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    recipient_user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    )
    type: str = Field(sa_column=Column(String(96), nullable=False))
    resource_type: Optional[str] = Field(default=None, sa_column=Column(String(40)))
    resource_id: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    score_id: Optional[str] = Field(default=None, sa_column=Column(String(36)))
    revision_id: Optional[str] = Field(default=None, sa_column=Column(String(36)))
    payload: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False, default=dict),
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
