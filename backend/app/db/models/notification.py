from __future__ import annotations

import uuid
from datetime import datetime
from enum import StrEnum
from sqlalchemy import (
    BigInteger,
    CheckConstraint,
    Column,
    DateTime,
    Enum,
    ForeignKey,
    Index,
    Integer,
    String,
)
from sqlmodel import Field, SQLModel
from app.shared.time import utc_now


class NotificationKind(StrEnum):
    SCORE_INVITE_ACCEPTED = "score_invite.accepted"
    SCORE_INVITE_DECLINED = "score_invite.declined"
    SCORE_VERSION_CREATED = "score.version.created"
    IMPORT_READY_FOR_REVIEW = "import.ready_for_review"
    IMPORT_FAILED = "import.failed"


class Notification(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "notifications"
    __table_args__ = (
        Index("idx_notifications_recipient_created", "recipient_user_id", "created_at", "id"),
        Index("idx_notifications_recipient_read", "recipient_user_id", "read_at"),
        CheckConstraint(
            """
          (kind IN ('score_invite.accepted', 'score_invite.declined') AND invite_id IS NOT NULL
           AND score_id IS NOT NULL AND actor_user_id IS NOT NULL AND score_display_title_snapshot IS NOT NULL
           AND revision_id IS NULL AND import_job_id IS NULL AND import_display_title_snapshot IS NULL)
          OR (kind = 'score.version.created' AND score_id IS NOT NULL AND revision_id IS NOT NULL
           AND actor_user_id IS NOT NULL AND score_display_title_snapshot IS NOT NULL AND invite_id IS NULL
           AND import_job_id IS NULL AND import_display_title_snapshot IS NULL)
          OR (kind = 'import.ready_for_review' AND import_job_id IS NOT NULL AND actor_user_id IS NULL
           AND invite_id IS NULL AND revision_id IS NULL
           AND ((score_id IS NULL AND score_display_title_snapshot IS NULL)
             OR (score_id IS NOT NULL AND score_display_title_snapshot IS NOT NULL)))
          OR (kind = 'import.failed' AND import_job_id IS NOT NULL AND actor_user_id IS NULL
           AND invite_id IS NULL AND revision_id IS NULL AND score_id IS NULL AND score_display_title_snapshot IS NULL)
        """,
            name="ck_notifications_semantic_identity",
        ),
    )
    id: int | None = Field(
        default=None,
        sa_column=Column(
            BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True
        ),
    )
    notification_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    recipient_user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False)
    )
    actor_user_id: int | None = Field(default=None, sa_column=Column(BigInteger))
    kind: NotificationKind = Field(
        sa_column=Column(
            Enum(
                NotificationKind,
                values_callable=lambda cls: [kind.value for kind in cls],
                native_enum=False,
                create_constraint=True,
                name="notificationkind",
            ),
            nullable=False,
        )
    )
    dedupe_key: str | None = Field(default=None, sa_column=Column(String(160), unique=True))
    invite_id: str | None = Field(default=None, sa_column=Column(String(36)))
    score_id: str | None = Field(default=None, sa_column=Column(String(36)))
    revision_id: str | None = Field(default=None, sa_column=Column(String(36)))
    import_job_id: str | None = Field(default=None, sa_column=Column(String(36)))
    score_display_title_snapshot: str | None = Field(default=None, sa_column=Column(String(255)))
    import_display_title_snapshot: str | None = Field(default=None, sa_column=Column(String(255)))
    read_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
    created_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), default=utc_now, nullable=False),
    )
