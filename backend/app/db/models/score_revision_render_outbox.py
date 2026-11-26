from __future__ import annotations

import app.modules.revisions.render_states as render_states

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
    UniqueConstraint,
)
from sqlalchemy import (
    Enum as SAEnum,
)
from sqlmodel import Field, SQLModel

from app.db.durable_delivery import (
    delivery_attempt_count_constraint,
    delivery_attempt_count_field,
    delivery_attempt_token_constraint,
    delivery_attempt_token_field,
    delivery_next_attempt_at_field,
    delivery_optional_timestamp_field,
    durable_failure_facts_constraint,
    failure_classification_field,
    failure_code_field,
    failure_detail_field,
    failure_retryable_field,
    failure_stage_field,
)
from app.shared.time import utc_now
from app.score_semantics.render_profile import SCORE_PRESENTATION_RENDER_PROFILE

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class ScoreRevisionRenderOutbox(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_revision_render_outbox"
    __table_args__ = (
        durable_failure_facts_constraint(name="ck_score_revision_render_outbox_failure_facts"),
        delivery_attempt_token_constraint(
            name="ck_score_revision_render_outbox_attempt_token",
            processing_status=render_states.ScoreRevisionRenderStatus.PROCESSING,
        ),
        delivery_attempt_count_constraint(name="ck_score_revision_render_outbox_attempt_count"),
        UniqueConstraint(
            "revision_id",
            "render_profile",
            name="uq_score_revision_render_outbox_revision_profile",
        ),
        Index("idx_score_revision_render_outbox_status_available", "status", "next_attempt_at"),
        Index("idx_score_revision_render_outbox_dispatched", "status", "dispatched_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    outbox_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    score_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("scores.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    revision_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("score_revisions.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )
    source_fingerprint: str = Field(sa_column=Column(String(64), nullable=False))
    requested_by_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL")),
    )
    originating_request_id: Optional[str] = Field(
        default=None,
        sa_column=Column(String(64), index=True),
    )
    traceparent: Optional[str] = Field(default=None, sa_column=Column(String(55)))
    tracestate: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    render_profile: str = Field(
        default=SCORE_PRESENTATION_RENDER_PROFILE,
        sa_column=Column(String(128), default=SCORE_PRESENTATION_RENDER_PROFILE, nullable=False),
    )
    status: render_states.ScoreRevisionRenderStatus = Field(
        default=render_states.ScoreRevisionRenderStatus.PENDING,
        sa_column=Column(
            SAEnum(
                render_states.ScoreRevisionRenderStatus,
                name="ck_score_revision_render_outbox_status",
                native_enum=False,
                create_constraint=True,
                validate_strings=True,
                values_callable=lambda cls: [value.value for value in cls],
                length=16,
            ),
            default=render_states.ScoreRevisionRenderStatus.PENDING,
            nullable=False,
        ),
    )
    attempt_token: str | None = delivery_attempt_token_field()
    attempt_count: int = delivery_attempt_count_field()
    next_attempt_at: datetime = delivery_next_attempt_at_field()
    dispatched_at: Optional[datetime] = delivery_optional_timestamp_field()
    started_at: Optional[datetime] = delivery_optional_timestamp_field()
    completed_at: Optional[datetime] = delivery_optional_timestamp_field()
    failure_detail: Optional[str] = failure_detail_field()
    failure_code: Optional[str] = failure_code_field()
    failure_stage: Optional[str] = failure_stage_field()
    failure_classification: Optional[str] = failure_classification_field()
    failure_retryable: Optional[bool] = failure_retryable_field()
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
