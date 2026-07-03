from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    String,
    UniqueConstraint,
)
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive

bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class MembershipRole(str, enum.Enum):
    EDITOR = "EDITOR"
    VIEWER = "VIEWER"


class InviteStatus(str, enum.Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"
    DECLINED = "DECLINED"


class PublicationStatus(str, enum.Enum):
    PUBLISHED = "PUBLISHED"
    UNPUBLISHED = "UNPUBLISHED"


class AccessOrigin(str, enum.Enum):
    OWNER = "OWNER"
    MEMBERSHIP = "MEMBERSHIP"
    SHARE = "SHARE"
    PUBLICATION = "PUBLICATION"


class ScoreMembership(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_memberships"
    __table_args__ = (
        UniqueConstraint("score_id", "user_id", name="uq_score_memberships_score_user"),
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
        Index("idx_score_invites_score_created", "score_id", "created_at"),
        Index("idx_score_invites_token_hash", "token_hash", unique=True),
        Index("idx_score_invites_email_status", "email", "status"),
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
    status: InviteStatus = Field(
        default=InviteStatus.PENDING,
        sa_column=Column(SAEnum(InviteStatus, name="invitestatus"), nullable=False),
    )
    created_by_user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False)
    )
    accepted_by_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("users.id")),
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    expires_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    accepted_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    revoked_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    declined_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))


class ScoreShareGrant(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_share_grants"
    __table_args__ = (
        Index("idx_score_share_grants_score_created", "score_id", "created_at"),
        Index("idx_score_share_grants_token_hash", "token_hash", unique=True),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    grant_uuid: str = Field(
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
    allow_download: bool = Field(
        default=False,
        sa_column=Column(Boolean, default=False, nullable=False),
    )
    allow_practice: bool = Field(
        default=False,
        sa_column=Column(Boolean, default=False, nullable=False),
    )
    expires_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    revoked_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    created_by_user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False)
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )



class ShareGrantRedemption(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "share_grant_redemptions"
    __table_args__ = (
        UniqueConstraint("grant_id", "user_id", name="uq_share_grant_redemptions_grant_user"),
        Index("idx_share_grant_redemptions_user_created", "user_id", "created_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    grant_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("score_share_grants.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    user_id: int = Field(sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )


class ScorePublication(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_publications"
    __table_args__ = (
        ForeignKeyConstraint(
            ["score_id", "published_revision_id"],
            ["score_revisions.score_id", "score_revisions.id"],
            name="fk_score_publications_revision",
        ),
        Index("idx_score_publications_status", "status"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    score_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("scores.id", ondelete="CASCADE"),
            unique=True,
            nullable=False,
        )
    )
    public_slug: str = Field(sa_column=Column(String(128), unique=True, nullable=False))
    published_revision_id: int = Field(sa_column=Column(BigInteger, nullable=False))
    status: PublicationStatus = Field(
        sa_column=Column(SAEnum(PublicationStatus, name="publicationstatus"), nullable=False)
    )
    allow_download: bool = Field(
        default=False,
        sa_column=Column(Boolean, default=False, nullable=False),
    )
    allow_practice: bool = Field(
        default=False,
        sa_column=Column(Boolean, default=False, nullable=False),
    )
    published_by_user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False)
    )
    published_at: datetime = Field(
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
