from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    JSON,
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlmodel import Field, Relationship, SQLModel

from app.db.durable_delivery import (
    durable_failure_facts_constraint,
    failure_classification_field,
    failure_code_field,
    failure_detail_field,
    failure_retryable_field,
    failure_stage_field,
)
from app.shared.time import utc_now

from .stored_object import StoredObject

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")
metadata_json_type = JSON().with_variant(JSONB, "postgresql")


class ImportArtifactKind(enum.StrEnum):
    REVIEW_MUSICXML = "review_musicxml"


class ImportJobState(str, enum.Enum):
    QUEUED = "QUEUED"
    PROCESSING = "PROCESSING"
    READY_FOR_REVIEW = "READY_FOR_REVIEW"
    CONFIRMED = "CONFIRMED"
    FAILED = "FAILED"


class ImportJobStepStatus(str, enum.Enum):
    PENDING = "PENDING"
    RUNNING = "RUNNING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ImportJob(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "import_jobs"
    __table_args__ = (
        durable_failure_facts_constraint(name="ck_import_jobs_failure_facts"),
        CheckConstraint(
            "(state = 'FAILED' AND failure_code IS NOT NULL AND failure_stage IS NOT NULL AND failure_classification IS NOT NULL AND failure_retryable IS NOT NULL) OR (state <> 'FAILED' AND failure_code IS NULL AND failure_stage IS NULL AND failure_classification IS NULL AND failure_retryable IS NULL)",
            name="ck_import_jobs_state_failure",
        ),
        CheckConstraint("progress >= 0 AND progress <= 100", name="ck_import_jobs_progress"),
        CheckConstraint(
            "(state = 'QUEUED' AND processing_started_at IS NULL AND processing_finished_at IS NULL AND confirmed_at IS NULL) OR "
            "(state = 'PROCESSING' AND processing_started_at IS NOT NULL AND processing_finished_at IS NULL AND confirmed_at IS NULL) OR "
            "(state = 'READY_FOR_REVIEW' AND processing_started_at IS NOT NULL AND processing_finished_at IS NOT NULL AND confirmed_at IS NULL) OR "
            "(state = 'CONFIRMED' AND processing_started_at IS NOT NULL AND processing_finished_at IS NOT NULL AND confirmed_at IS NOT NULL) OR "
            "(state = 'FAILED' AND processing_finished_at IS NOT NULL AND confirmed_at IS NULL)",
            name="ck_import_jobs_lifecycle",
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
    requested_options: dict[str, object] = Field(
        sa_column=Column(metadata_json_type, nullable=False)
    )
    execution_manifest_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("execution_manifests.id"), index=True),
    )
    failure_code: Optional[str] = failure_code_field()
    failure_stage: Optional[str] = failure_stage_field()
    failure_classification: Optional[str] = failure_classification_field()
    failure_retryable: Optional[bool] = failure_retryable_field()
    failure_detail: Optional[str] = failure_detail_field()
    processing_started_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    processing_last_heartbeat_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    processing_finished_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    confirmed_at: Optional[datetime] = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
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
    kind: ImportArtifactKind = Field(
        sa_column=Column(
            SAEnum(
                ImportArtifactKind,
                name="importartifactkind",
                values_callable=lambda kind: [value.value for value in kind],
                validate_strings=True,
            ),
            nullable=False,
        )
    )

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
