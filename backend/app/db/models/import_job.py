from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
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


class ImportJobState(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    PENDING_REVIEW = "PENDING_REVIEW"
    CONFIRMED = "CONFIRMED"
    FAILURE = "FAILURE"


class ImportJobStepStatus(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ImportDispatchStatus(str, enum.Enum):
    PENDING = "PENDING"
    DISPATCHED = "DISPATCHED"
    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ImportJob(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "import_jobs"
    __table_args__ = (
        CheckConstraint(
            "dispatch_attempt_count >= 0",
            name="ck_import_jobs_dispatch_attempt_count",
        ),
        CheckConstraint(
            "publish_attempt_count >= 0",
            name="ck_import_jobs_publish_attempt_count",
        ),
        UniqueConstraint(
            "user_id",
            "idempotency_key",
            name="uq_import_jobs_user_idempotency_key",
        ),
        Index("idx_import_jobs_user_created", "user_id", "created_at"),
        Index("idx_import_jobs_state", "state"),
        Index("idx_import_jobs_dispatch_due", "dispatch_status", "next_dispatch_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    job_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    user_id: int = Field(sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False))
    state: ImportJobState = Field(
        sa_column=Column(
            SAEnum(ImportJobState, name="importjobstate"),
            nullable=False,
        )
    )
    progress: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    current_step: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    idempotency_key: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    originating_request_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String(64), index=True),
    )
    traceparent: Optional[str] = Field(default=None, sa_column=Column(String(55)))
    tracestate: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    requested_options: Optional[dict[str, object]] = Field(
        default=None,
        sa_column=Column(metadata_json_type),
    )
    dispatch_status: ImportDispatchStatus = Field(
        default=ImportDispatchStatus.PENDING,
        sa_column=Column(
            SAEnum(ImportDispatchStatus, name="importdispatchstatus"),
            default=ImportDispatchStatus.PENDING,
            nullable=False,
        ),
    )
    dispatch_attempt_count: int = Field(
        default=0,
        sa_column=Column(Integer, default=0, nullable=False),
    )
    publish_attempt_count: int = Field(
        default=0,
        sa_column=Column(Integer, default=0, nullable=False),
    )
    next_dispatch_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    dispatched_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    dispatch_started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    dispatch_completed_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    dispatch_error: Optional[str] = Field(default=None, sa_column=Column(Text))
    internal_error_code: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    internal_error_stage: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    internal_error_class: Optional[str] = Field(default=None, sa_column=Column(String(32)))
    internal_error_retryable: Optional[bool] = Field(default=None, sa_column=Column(Boolean))
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
                name="fk_import_jobs_score_id",
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


class ImportJobStep(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "import_job_steps"
    __table_args__ = (
        UniqueConstraint("job_id", "name", name="uq_import_job_steps_job_name"),
        Index("idx_import_job_steps_job_order", "job_id", "step_order"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    job_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("import_jobs.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    name: str = Field(sa_column=Column(String(64), nullable=False))
    status: ImportJobStepStatus = Field(
        sa_column=Column(
            SAEnum(ImportJobStepStatus, name="importjobstepstatus"),
            nullable=False,
        )
    )
    start_time: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    end_time: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    step_order: int = Field(sa_column=Column(Integer, nullable=False))


class ImportJobUpload(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "import_job_uploads"
    __table_args__ = (
        UniqueConstraint("job_id", "upload_id", name="uq_import_job_uploads_job_upload"),
        Index("idx_import_job_uploads_job", "job_id"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    job_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("import_jobs.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    upload_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("uploads.id"), nullable=False)
    )
    page_number: int = Field(sa_column=Column(Integer, nullable=False))
    sort_order: int = Field(sa_column=Column(Integer, nullable=False))


class ImportArtifact(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "import_artifacts"
    __table_args__ = (
        UniqueConstraint("storage_key", name="uq_import_artifacts_storage_key"),
        Index("idx_import_artifacts_job_kind", "job_id", "kind"),
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
            ForeignKey("import_jobs.id", ondelete="CASCADE"),
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
