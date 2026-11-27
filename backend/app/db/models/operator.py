"""Control Plane password identities, MFA challenges and authenticated sessions."""

from datetime import datetime
from uuid import uuid4
from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Enum as SAEnum,
    ForeignKey,
    Index,
    Integer,
    String,
    CheckConstraint,
)
from sqlmodel import Field, SQLModel
from app.modules.platform_operators.domain import OperatorRole, OperatorStatus, ChallengePurpose
from app.shared.time import utc_now


def enum_values(kind):
    return [item.value for item in kind]


class Operator(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "operators"
    __table_args__ = (
        Index("idx_operators_status_role", "status", "role"),
        CheckConstraint(
            "(totp_enabled_at IS NULL AND totp_secret_encrypted IS NULL AND totp_last_used_step IS NULL) OR (totp_enabled_at IS NOT NULL AND totp_secret_encrypted IS NOT NULL AND totp_last_used_step IS NOT NULL)",
            name="ck_operators_totp_facts",
        ),
    )
    id: int | None = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    operator_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    email: str = Field(sa_column=Column(String(255), unique=True, nullable=False))
    display_name: str = Field(sa_column=Column(String(128), nullable=False))
    password_hash: str = Field(sa_column=Column(String(255), nullable=False))
    role: OperatorRole = Field(
        default=OperatorRole.PLATFORM_OPERATOR,
        sa_column=Column(
            SAEnum(OperatorRole, name="operatorrole", values_callable=enum_values), nullable=False
        ),
    )
    status: OperatorStatus = Field(
        default=OperatorStatus.ACTIVE,
        sa_column=Column(
            SAEnum(OperatorStatus, name="operatorstatus", values_callable=enum_values),
            nullable=False,
        ),
    )
    totp_secret_encrypted: str | None = Field(default=None, sa_column=Column(String(512)))
    totp_enabled_at: datetime | None = Field(
        default=None, sa_column=Column(DateTime(timezone=True))
    )
    totp_last_used_step: int | None = Field(default=None, sa_column=Column(BigInteger))
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    updated_at: datetime = Field(
        default_factory=utc_now,
        sa_column=Column(DateTime(timezone=True), onupdate=utc_now, nullable=False),
    )


class OperatorSession(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "operator_sessions"
    __table_args__ = (
        Index("idx_operator_sessions_operator_created", "operator_id", "created_at"),
        Index("idx_operator_sessions_expiry", "idle_expires_at", "absolute_expires_at"),
        CheckConstraint(
            "created_at <= last_seen_at AND last_seen_at < absolute_expires_at AND idle_expires_at <= absolute_expires_at",
            name="ck_operator_sessions_lifetime",
        ),
    )
    id: int | None = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    session_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    operator_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("operators.id", ondelete="RESTRICT"), nullable=False
        )
    )
    token_hash: str = Field(sa_column=Column(String(64), unique=True, nullable=False))
    ip_address: str | None = Field(default=None, sa_column=Column(String(64)))
    user_agent: str | None = Field(default=None, sa_column=Column(String(512)))
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    last_seen_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    idle_expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    absolute_expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    revoked_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class OperatorMfaChallenge(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "operator_mfa_challenges"
    __table_args__ = (
        Index("idx_operator_mfa_challenges_operator_expiry", "operator_id", "expires_at"),
        CheckConstraint(
            "attempt_count >= 0 AND attempt_count <= 5", name="ck_operator_mfa_attempts"
        ),
    )
    id: int | None = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    challenge_uuid: str = Field(
        default_factory=lambda: str(uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    operator_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("operators.id", ondelete="RESTRICT"), nullable=False
        )
    )
    token_hash: str = Field(sa_column=Column(String(64), unique=True, nullable=False))
    purpose: ChallengePurpose = Field(
        sa_column=Column(
            SAEnum(ChallengePurpose, name="operatorchallengepurpose", values_callable=enum_values),
            nullable=False,
        )
    )
    pending_secret_encrypted: str | None = Field(default=None, sa_column=Column(String(512)))
    attempt_count: int = Field(default=0, sa_column=Column(Integer, nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    expires_at: datetime = Field(sa_column=Column(DateTime(timezone=True), nullable=False))
    consumed_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))


class OperatorRecoveryCode(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "operator_recovery_codes"
    __table_args__ = (Index("idx_operator_recovery_codes_owner", "operator_id"),)
    id: int | None = Field(default=None, sa_column=Column(BigInteger, primary_key=True))
    operator_id: int = Field(
        sa_column=Column(
            BigInteger, ForeignKey("operators.id", ondelete="RESTRICT"), nullable=False
        )
    )
    code_hash: str = Field(sa_column=Column(String(64), unique=True, nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now, sa_column=Column(DateTime(timezone=True), nullable=False)
    )
    consumed_at: datetime | None = Field(default=None, sa_column=Column(DateTime(timezone=True)))
