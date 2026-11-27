from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Column, DateTime, Index, Integer, String, Text
from sqlmodel import Field, SQLModel

from app.shared.time import utc_now


bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class SchedulerHeartbeat(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "scheduler_heartbeats"
    __table_args__ = (
        Index("idx_scheduler_heartbeats_job_key", "job_key", unique=True),
        Index("idx_scheduler_heartbeats_last_success", "last_success_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    job_key: str = Field(sa_column=Column(String(80), nullable=False))
    last_started_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    last_success_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    last_failure_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    last_duration_ms: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    last_due_count: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    last_dispatched_count: int = Field(
        default=0,
        sa_column=Column(Integer, default=0, nullable=False),
    )
    total_duration_ms: int = Field(
        default=0,
        sa_column=Column(Integer, default=0, nullable=False),
    )
    total_due_count: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    total_dispatched_count: int = Field(
        default=0,
        sa_column=Column(Integer, default=0, nullable=False),
    )
    lock_acquired_count: int = Field(
        default=0,
        sa_column=Column(Integer, default=0, nullable=False),
    )
    lock_skipped_count: int = Field(
        default=0,
        sa_column=Column(Integer, default=0, nullable=False),
    )
    last_lock_skipped_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    success_count: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    failure_count: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    last_error: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), default=utc_now, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            default=utc_now,
            onupdate=utc_now,
            nullable=False,
        ),
    )


class SchedulerLeaderStatus(SQLModel, table=True):  # type: ignore[call-arg]
    """Durable observability state for the Beat active/standby supervisor."""

    __tablename__ = "scheduler_leader_statuses"

    scheduler_name: str = Field(
        sa_column=Column(String(80), primary_key=True),
    )
    last_acquired_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    last_heartbeat_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    last_standby_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    last_child_exit_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    acquired_count: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    standby_count: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    child_exit_count: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    last_error: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), default=utc_now, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(
            DateTime(timezone=True),
            default=utc_now,
            onupdate=utc_now,
            nullable=False,
        ),
    )
