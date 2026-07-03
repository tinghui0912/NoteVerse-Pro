from __future__ import annotations

import enum
from datetime import datetime
from typing import Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    CheckConstraint,
    Column,
    DateTime,
    Enum as SAEnum,
    Float,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    Integer,
    JSON,
    String,
    UniqueConstraint,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlmodel import Field, SQLModel

from app.utils.timezone import utc_now_naive


class RevisionOrigin(str, enum.Enum):
    OMR = "OMR"
    EDIT = "EDIT"
    IMPORT = "IMPORT"


class ArtifactKind(str, enum.Enum):
    MUSICXML = "MUSICXML"
    RENDERED_PAGE = "RENDERED_PAGE"


class MetadataStatus(str, enum.Enum):
    PENDING = "PENDING"
    READY = "READY"
    FAILED = "FAILED"


metadata_json_type = JSON().with_variant(JSONB, "postgresql")
bigint_pk_type = BigInteger().with_variant(Integer, "sqlite")


class Score(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "scores"
    __table_args__ = (
        CheckConstraint("version >= 1", name="ck_scores_version_positive"),
        ForeignKeyConstraint(
            ["id", "head_revision_id"],
            ["score_revisions.score_id", "score_revisions.id"],
            name="fk_scores_head_revision",
            use_alter=True,
        ),
        Index("idx_scores_owner_updated", "owner_user_id", "updated_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    score_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    owner_user_id: int = Field(
        sa_column=Column(BigInteger, ForeignKey("users.id"), nullable=False)
    )
    title: str = Field(sa_column=Column(String(255), nullable=False))
    head_revision_id: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    originating_job_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            BigInteger,
            ForeignKey("processing_jobs.id", ondelete="SET NULL"),
            unique=True,
        ),
    )
    version: int = Field(default=1, sa_column=Column(Integer, default=1, nullable=False))
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


class TaxonomyCategory(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "taxonomy_categories"
    __table_args__ = (
        UniqueConstraint("code", name="uq_taxonomy_categories_code"),
        Index("idx_taxonomy_categories_active_sort", "is_active", "sort_order"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    code: str = Field(sa_column=Column(String(64), nullable=False))
    name_key: str = Field(sa_column=Column(String(128), nullable=False))
    sort_order: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    is_active: bool = Field(
        default=True,
        sa_column=Column(Boolean, default=True, nullable=False),
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )


class TaxonomyTag(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "taxonomy_tags"
    __table_args__ = (
        UniqueConstraint("category_id", "code", name="uq_taxonomy_tags_category_code"),
        Index("idx_taxonomy_tags_category_active_sort", "category_id", "is_active", "sort_order"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    category_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("taxonomy_categories.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    code: str = Field(sa_column=Column(String(64), nullable=False))
    name_key: str = Field(sa_column=Column(String(128), nullable=False))
    aliases: list[str] = Field(
        default_factory=list,
        sa_column=Column(metadata_json_type, default=list, nullable=False),
    )
    sort_order: int = Field(default=0, sa_column=Column(Integer, default=0, nullable=False))
    is_active: bool = Field(
        default=True,
        sa_column=Column(Boolean, default=True, nullable=False),
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )


class ScoreTaxonomyTag(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_taxonomy_tags"
    __table_args__ = (
        Index("idx_score_taxonomy_tags_tag_score", "tag_id", "score_id"),
    )

    score_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("scores.id", ondelete="CASCADE"),
            primary_key=True,
        )
    )
    tag_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("taxonomy_tags.id", ondelete="RESTRICT"),
            primary_key=True,
        )
    )
    source: str = Field(
        default="USER",
        sa_column=Column(String(32), default="USER", nullable=False),
    )
    confidence: Optional[float] = Field(default=None, sa_column=Column(Float))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )


class ScoreRevision(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_revisions"
    __table_args__ = (
        CheckConstraint("revision_number >= 1", name="ck_score_revisions_number_positive"),
        UniqueConstraint("score_id", "id", name="uq_score_revisions_score_id_id"),
        UniqueConstraint(
            "score_id",
            "revision_number",
            name="uq_score_revisions_score_number",
        ),
        UniqueConstraint(
            "score_id",
            "content_hash",
            name="uq_score_revisions_score_content_hash",
        ),
        UniqueConstraint(
            "score_id",
            "idempotency_key",
            name="uq_score_revisions_score_idempotency_key",
        ),
        ForeignKeyConstraint(
            ["score_id", "parent_revision_id"],
            ["score_revisions.score_id", "score_revisions.id"],
            name="fk_score_revisions_parent",
        ),
        ForeignKeyConstraint(
            ["score_id", "base_revision_id"],
            ["score_revisions.score_id", "score_revisions.id"],
            name="fk_score_revisions_base",
        ),
        Index("idx_score_revisions_score_created", "score_id", "created_at"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    revision_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    score_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("scores.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    revision_number: int = Field(sa_column=Column(Integer, nullable=False))
    parent_revision_id: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    base_revision_id: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    content_hash: str = Field(sa_column=Column(String(64), nullable=False))
    idempotency_key: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    origin: RevisionOrigin = Field(
        sa_column=Column(SAEnum(RevisionOrigin, name="revisionorigin"), nullable=False)
    )
    created_by_user_id: Optional[int] = Field(
        default=None,
        sa_column=Column(BigInteger, ForeignKey("users.id", ondelete="SET NULL")),
    )
    created_by_job_id: Optional[int] = Field(
        default=None,
        sa_column=Column(
            BigInteger,
            ForeignKey("processing_jobs.id", ondelete="SET NULL"),
        ),
    )
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )


class ScoreArtifact(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_artifacts"
    __table_args__ = (
        CheckConstraint(
            "kind != 'RENDERED_PAGE' OR (render_profile IS NOT NULL AND page_number IS NOT NULL)",
            name="ck_score_artifacts_rendered_page_fields",
        ),
        UniqueConstraint("storage_key", name="uq_score_artifacts_storage_key"),
        UniqueConstraint(
            "revision_id",
            "kind",
            "render_profile",
            "page_number",
            name="uq_score_artifacts_rendered_variant",
        ),
        Index(
            "uq_score_artifacts_canonical_musicxml",
            "revision_id",
            unique=True,
            postgresql_where=text("kind = 'MUSICXML'"),
            sqlite_where=text("kind = 'MUSICXML'"),
        ),
        Index("idx_score_artifacts_revision_kind", "revision_id", "kind"),
    )

    id: Optional[int] = Field(
        default=None,
        sa_column=Column(bigint_pk_type, primary_key=True, autoincrement=True),
    )
    artifact_uuid: str = Field(sa_column=Column(String(36), unique=True, nullable=False))
    revision_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("score_revisions.id", ondelete="CASCADE"),
            nullable=False,
        )
    )
    kind: ArtifactKind = Field(
        sa_column=Column(SAEnum(ArtifactKind, name="artifactkind"), nullable=False)
    )
    storage_backend: str = Field(sa_column=Column(String(32), nullable=False))
    storage_key: str = Field(sa_column=Column(String(768), nullable=False))
    filename: str = Field(sa_column=Column(String(255), nullable=False))
    mime_type: str = Field(sa_column=Column(String(128), nullable=False))
    size_bytes: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    sha256: str = Field(sa_column=Column(String(64), nullable=False))
    page_number: Optional[int] = Field(default=None, sa_column=Column(Integer))
    render_profile: Optional[str] = Field(default=None, sa_column=Column(String(128)))
    generator: str = Field(sa_column=Column(String(64), nullable=False))
    generator_version: str = Field(sa_column=Column(String(64), nullable=False))
    created_at: datetime = Field(
        default_factory=utc_now_naive,
        sa_column=Column(DateTime, default=utc_now_naive, nullable=False),
    )


class ScoreRevisionMetadata(SQLModel, table=True):  # type: ignore[call-arg]
    __tablename__ = "score_revision_metadata"
    __table_args__ = (
        CheckConstraint(
            "status != 'READY' OR error_code IS NULL",
            name="ck_score_revision_metadata_ready_without_error",
        ),
        CheckConstraint(
            "status != 'FAILED' OR error_code IS NOT NULL",
            name="ck_score_revision_metadata_failed_with_error",
        ),
        Index("idx_score_revision_metadata_status", "status"),
        Index("idx_score_revision_metadata_measure_count", "measure_count"),
    )

    revision_id: int = Field(
        sa_column=Column(
            BigInteger,
            ForeignKey("score_revisions.id", ondelete="CASCADE"),
            primary_key=True,
        )
    )
    status: MetadataStatus = Field(
        default=MetadataStatus.PENDING,
        sa_column=Column(
            SAEnum(MetadataStatus, name="metadatastatus"),
            default=MetadataStatus.PENDING,
            nullable=False,
        ),
    )
    measure_count: Optional[int] = Field(default=None, sa_column=Column(Integer))
    playback_duration_ms: Optional[int] = Field(default=None, sa_column=Column(BigInteger))
    part_count: Optional[int] = Field(default=None, sa_column=Column(Integer))
    primary_key_fifths: Optional[int] = Field(default=None, sa_column=Column(Integer))
    primary_mode: Optional[str] = Field(default=None, sa_column=Column(String(32)))
    key_signature_events: list[dict[str, object]] = Field(
        default_factory=list,
        sa_column=Column(metadata_json_type, default=list, nullable=False),
    )
    time_signature_events: list[dict[str, object]] = Field(
        default_factory=list,
        sa_column=Column(metadata_json_type, default=list, nullable=False),
    )
    tempo_events: list[dict[str, object]] = Field(
        default_factory=list,
        sa_column=Column(metadata_json_type, default=list, nullable=False),
    )
    extractor_version: str = Field(sa_column=Column(String(64), nullable=False))
    error_code: Optional[str] = Field(default=None, sa_column=Column(String(64)))
    computed_at: Optional[datetime] = Field(default=None, sa_column=Column(DateTime))
