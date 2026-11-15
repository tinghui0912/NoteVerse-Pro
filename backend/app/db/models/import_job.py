from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    CheckConstraint,
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
from sqlmodel import Field, Relationship, SQLModel
from sqlalchemy.orm import relationship
from .stored_object import StoredObject

from app.shared.time import utc_now

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


class ImportJob(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "import_jobs"
    __table_args__ = (
        CheckConstraint(
            "((internal_error_code IS NULL AND internal_error_stage IS NULL AND internal_error_class IS NULL AND internal_error_retryable IS NULL) OR (internal_error_code IS NOT NULL AND internal_error_stage IS NOT NULL AND internal_error_class IS NOT NULL AND internal_error_retryable IS NOT NULL AND internal_error_class IN ('transient', 'permanent', 'user_error', 'system_error')))",
            name="ck_import_jobs_failure_metadata",
        ),
        UniqueConstraint(
            "user_id",
            "idempotency_key",
            name="uq_import_jobs_user_idempotency_key",
        ),
        Index("idx_import_jobs_user_created", "user_id", "created_at"),
        Index("idx_import_jobs_state", "state"),
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
    requested_options: Optional[dict[str, object]] = Field(
        default=None,
        sa_column=Column(metadata_json_type),
    )
    execution_manifest_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("execution_manifests.id"), index=True),
    )
    internal_error_code: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    internal_error_stage: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    internal_error_class: Optional[str] = Field(default=None, sa_column=Column(String(32)))
    internal_error_retryable: Optional[bool] = Field(default=None, sa_column=Column(Boolean))
    internal_error_detail: Optional[str] = Field(default=None, sa_column=Column(Text))
    code: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    error: Optional[str] = Field(default=None, sa_column=Column(Text))
    error_type: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    requested_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    started_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    last_heartbeat_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    finished_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
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
    start_time: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    end_time: Optional[datetime] = Field(default=None, sa_column=Column(DateTime(timezone=True)))
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
    upload_id: int = Field(sa_column=Column(BigInteger, ForeignKey("uploads.id"), nullable=False))
    page_number: int = Field(sa_column=Column(Integer, nullable=False))
    sort_order: int = Field(sa_column=Column(Integer, nullable=False))


class ImportArtifact(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "import_artifacts"
    __table_args__ = (
        UniqueConstraint("stored_object_id", name="uq_import_artifacts_stored_object"),
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

    stored_object_id: int = Field(
        sa_column=Column(
            bigint_pk_type, ForeignKey("stored_objects.id", ondelete="RESTRICT"), nullable=False
        )
    )
    stored_object: StoredObject = Relationship(
        sa_relationship=relationship(StoredObject, lazy="selectin")
    )
    filename: str = Field(sa_column=Column(String(255), nullable=False))
    page_number: Optional[int] = Field(default=None, sa_column=Column(Integer))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), default=utc_now, nullable=False),
    )
