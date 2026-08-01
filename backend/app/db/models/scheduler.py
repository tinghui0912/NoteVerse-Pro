from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Column, DateTime, Index, Integer, String, Text
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive


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
    last_started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    last_success_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    last_failure_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
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
    last_lock_skipped_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    success_count: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    failure_count: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    last_error: Optional[str] = Field(default=None, sa_column=Column(Text))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(
            DateTime,
            default=utc_now_naive,
            onupdate=utc_now_naive,
            nullable=False,
        ),
    )
