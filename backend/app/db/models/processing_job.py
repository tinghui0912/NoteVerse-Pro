from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")
metadata_json_type = JSON().with_variant(JSONB, "postgresql")


class ProcessingJobState(str, enum.Enum):
    PENDING = "PENDING"
    PROGRESS = "PROGRESS"
    PENDING_REVIEW = "PENDING_REVIEW"
    SUCCESS = "SUCCESS"
    FAILURE = "FAILURE"


class ProcessingJobStepStatus(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ProcessingJob(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "processing_jobs"
    __table_args__ = (
        UniqueConstraint(
            "user_id",
            "idempotency_key",
            name="uq_processing_jobs_user_idempotency_key",
        ),
        Index("idx_processing_jobs_user_created", "user_id", "created_at"),
        Index("idx_processing_jobs_state", "state"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    job_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    user_id: int = Field(sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False))
    state: ProcessingJobState = Field(
        sa_column=Column(
            SAEnum(ProcessingJobState, name="processingjobstate"),
            nullable=False,
        )
    )
    progress: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    current_step: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    idempotency_key: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    requested_options: Optional[dict[str, object]] = Field(
        default=None,
        sa_column=Column(metadata_json_type),
    )
    code: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    error: Optional[str] = Field(default=None, sa_column=Column(Text))
    error_type: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    requested_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    last_heartbeat_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    finished_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    score_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            BigInteger,
            ForeignKey(
                "scores.id",
                name="fk_processing_jobs_score_id",
                use_alter=True,
                ondelete="SET NULL",
            ),
        ),
    )
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


class ProcessingJobStep(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "processing_job_steps"
    __table_args__ = (
        UniqueConstraint("job_id", "name", name="uq_processing_job_steps_job_name"),
        Index("idx_processing_job_steps_job_order", "job_id", "step_order"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    job_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("processing_jobs.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    name: str = Field(sa_column=Column(String(64), nullable=False))
    status: ProcessingJobStepStatus = Field(
        sa_column=Column(
            SAEnum(ProcessingJobStepStatus, name="processingjobstepstatus"),
            nullable=False,
        )
    )
    start_time: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    end_time: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    step_order: int = Field(sa_column=Column(Integer, nullable=False))


class ProcessingJobUpload(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "processing_job_uploads"
    __table_args__ = (
        UniqueConstraint("job_id", "upload_id", name="uq_processing_job_uploads_job_upload"),
        Index("idx_processing_job_uploads_job", "job_id"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    job_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("processing_jobs.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    upload_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("uploads.id"), nullable=False)
    )


class ProcessingArtifact(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "processing_artifacts"
    __table_args__ = (
        UniqueConstraint("storage_key", name="uq_processing_artifacts_storage_key"),
        Index("idx_processing_artifacts_job_kind", "job_id", "kind"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    artifact_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    job_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("processing_jobs.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    kind: str = Field(sa_column=Column(String(64), nullable=False))
    storage_backend: str = Field(sa_column=Column(String(32), nullable=False))
    storage_key: str = Field(sa_column=Column(String(768), nullable=False))
    filename: str = Field(sa_column=Column(String(255), nullable=False))
    mime_type: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    size_bytes: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    sha256: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    page_number: Optional[int] = Field(default=None, sa_column=Column(Integer))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
