from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Column,
    CheckConstraint,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    UniqueConstraint,
    text,
)
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class MembershipRole(str, enum.Enum):
    VIEWER = "VIEWER"
    PRACTITIONER = "PRACTITIONER"
    EDITOR = "EDITOR"


class InviteTerminalOutcome(str, enum.Enum):
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    REVOKED = "REVOKED"


class AccessOrigin(str, enum.Enum):
    OWNER = "OWNER"
    MEMBERSHIP = "MEMBERSHIP"


class ScoreMembership(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_memberships"
    __table_args__ = (
        UniqueConstraint("score_id", "user_id", name="uq_score_memberships_score_user"),
        Index("idx_score_memberships_score_created", "score_id", "created_at", "id"),
        Index("idx_score_memberships_user_active", "user_id", "revoked_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    score_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("scores.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    user_id: int = Field(sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False))
    role: MembershipRole = Field(
        sa_column=Column(SAEnum(MembershipRole, name="membershiprole"), nullable=False)
    )
    created_by_user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False)
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    revoked_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))


class ScoreInvite(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_invites"
    __table_args__ = (
        Index("idx_score_invites_score_created", "score_id", "created_at", "id"),
        Index("idx_score_invites_token_hash", "token_hash", unique=True),
        Index(
            "idx_score_invites_email_unresolved_created",
            "email",
            "created_at",
            "id",
            postgresql_where=text("terminal_outcome IS NULL"),
            sqlite_where=text("terminal_outcome IS NULL"),
        ),
        CheckConstraint(
            "(terminal_outcome IS NULL AND terminal_at IS NULL AND terminal_actor_user_id IS NULL) OR "
            "(terminal_outcome IS NOT NULL AND terminal_at IS NOT NULL AND terminal_actor_user_id IS NOT NULL)",
            name="ck_score_invites_terminal_facts",
        ),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    invite_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    score_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("scores.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    token_hash: str = Field(sa_column=Column(String(64), nullable=False))
    email: Optional[str] = Field(default=None, sa_column=Column(String(255)))
    role: MembershipRole = Field(
        sa_column=Column(SAEnum(MembershipRole, name="membershiprole"), nullable=False)
    )
    terminal_outcome: Optional[InviteTerminalOutcome] = Field(
        default=None,
        sa_column=Column(SAEnum(InviteTerminalOutcome, name="inviteterminaloutcome")),
    )
    created_by_user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False)
    )
    terminal_actor_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("users.id")),
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    expires_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    terminal_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
