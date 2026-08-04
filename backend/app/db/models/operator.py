"""Persistent identity and session records for the control-plane audience."""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Column, DateTime, Enum as SAEnum, ForeignKey, Index, Integer, String, UniqueConstraint
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive


bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


def _enum_values(enum_class: type[enum.Enum]) -> list[str]:
    """Persist explicit enum values so ORM bindings match PostgreSQL enum types."""
    return [str(member.value) for member in enum_class]


class OperatorRole(str, enum.Enum):
    PLATFORM_OPERATOR = "platform_operator"


class OperatorStatus(str, enum.Enum):
    ACTIVE = "active"
    DISABLED = "disabled"


class OperatorIdentityProvider(str, enum.Enum):
    LOCAL_PASSWORD = "local_password"
    OIDC = "oidc"


class Operator(SQLModel, table=True):  # type: ignore[call-arg]
    """Authorization principal for a person operating the platform."""

    __tablename__ = "operators"
    __table_args__ = (
        Index("idx_operators_status", "status"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    operator_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    display_name: str = Field(sa_column=Column(String(128), nullable=False))
    role: OperatorRole = Field(
        default=OperatorRole.PLATFORM_OPERATOR,
        sa_column=Column(
            SAEnum(OperatorRole, name="operatorrole", values_callable=_enum_values),
            default=OperatorRole.PLATFORM_OPERATOR,
            nullable=False,
        ),
    )
    status: OperatorStatus = Field(
        default=OperatorStatus.ACTIVE,
        sa_column=Column(
            SAEnum(OperatorStatus, name="operatorstatus", values_callable=_enum_values),
            default=OperatorStatus.ACTIVE,
            nullable=False,
        ),
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False),
    )


class OperatorIdentity(SQLModel, table=True):  # type: ignore[call-arg]
    """Provider binding for an operator; authorization never depends on its provider."""

    __tablename__ = "operator_identities"
    __table_args__ = (
        UniqueConstraint("provider", "issuer", "subject", name="uq_operator_identities_provider_issuer_subject"),
        Index("idx_operator_identities_operator", "operator_id"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    identity_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    operator_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("operators.id", ondelete="CASCADE"), nullable=False)
    )
    provider: OperatorIdentityProvider = Field(
        sa_column=Column(
            SAEnum(
                OperatorIdentityProvider,
                name="operatoridentityprovider",
                values_callable=_enum_values,
            ),
            nullable=False,
        )
    )
    issuer: str = Field(sa_column=Column(String(255), nullable=False))
    subject: str = Field(sa_column=Column(String(255), nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    last_authenticated_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))


class OperatorPasswordCredential(SQLModel, table=True):  # type: ignore[call-arg]
    """Argon2id verifier for a local-password identity only."""

    __tablename__ = "operator_password_credentials"

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    identity_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("operator_identities.id", ondelete="CASCADE"),
            unique=True,
            nullable=False,
        )
    )
    password_hash: str = Field(sa_column=Column(String(255), nullable=False))
    password_changed_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    updated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, onupdate=utc_now_naive, nullable=False),
    )


class OperatorSession(SQLModel, table=True):  # type: ignore[call-arg]
    """Opaque, revocable session for the control-plane browser surface."""

    __tablename__ = "operator_sessions"
    __table_args__ = (
        Index("idx_operator_sessions_operator_created", "operator_id", "created_at"),
        Index("idx_operator_sessions_expires", "expires_at"),
        Index("idx_operator_sessions_revoked", "revoked_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    session_uuid: str = Field(
        default_factory=lambda: str(uuid.uuid4()),
        sa_column=Column(String(36), unique=True, nullable=False),
    )
    identity_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("operator_identities.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    operator_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("operators.id", ondelete="CASCADE"), nullable=False)
    )
    token_hash: str = Field(sa_column=Column(String(64), unique=True, nullable=False))
    user_agent: Optional[str] = Field(default=None, sa_column=Column(String(512)))
    ip_address: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    authenticated_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    expires_at: datetime = Field(sa_column=Column(DateTime, nullable=False))
    revoked_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
    last_used_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
