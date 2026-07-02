from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, Index, Integer, JSON, String
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class NotificationEvent(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "notification_events"
    __table_args__ = (
        Index("idx_notification_events_recipient_created", "recipient_user_id", "created_at"),
        Index("idx_notification_events_recipient_read", "recipient_user_id", "read_at"),
        Index("idx_notification_events_resource", "resource_type", "resource_id"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    notification_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    recipient_user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False)
    )
    actor_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("users.id")),
    )
    type: str = Field(sa_column=Column(String(80), nullable=False))
    dedupe_key: Optional[str] = Field(
        default=None,
        sa_column=Column(String(160), unique=True),
    )
    resource_type: str = Field(sa_column=Column(String(40), nullable=False))
    resource_id: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    score_id: Optional[str] = Field(default=None, sa_column=Column(String(36)))
    title: str = Field(sa_column=Column(String(255), nullable=False))
    body: Optional[str] = Field(default=None, sa_column=Column(String(1024)))
    data: dict[str, Any] = Field(
        default_factory=dict,
        sa_column=Column(JSON, nullable=False, default=dict),
    )
    read_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
