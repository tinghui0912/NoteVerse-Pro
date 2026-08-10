"""Immutable, content-addressed execution identity records."""

from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, Column, DateTime, Integer, JSON, String, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive


bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")
manifest_json_type = JSON().with_variant(JSONB, "postgresql")


class ExecutionManifest(SQLModel, table=True):  # type: ignore[call-arg]
    """A resolved execution identity shared by all jobs with the same digest."""

    __tablename__ = "execution_manifests"
    __table_args__ = (UniqueConstraint("sha256", name="uq_execution_manifests_sha256"),)

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    sha256: str = Field(sa_column=Column(String(64), nullable=False))
    manifest: dict[str, object] = Field(sa_column=Column(manifest_json_type, nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )
