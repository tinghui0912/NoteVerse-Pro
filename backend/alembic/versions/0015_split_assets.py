"""split revision sources and render assets

Revision ID: 0015_split_assets
Revises: 0014_score_revision_notes
Create Date: 2026-07-13 00:00:00.000000

"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0015_split_assets"
down_revision: str | Sequence[str] | None = "0014_score_revision_notes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    sa.Enum("MUSICXML", name="revisionsourceformat").create(bind, checkfirst=True)
    sa.Enum("RENDERED_PAGE", name="renderassetkind").create(bind, checkfirst=True)
    revision_source_format = postgresql.ENUM(
        "MUSICXML",
        name="revisionsourceformat",
        create_type=False,
    )
    render_asset_kind = postgresql.ENUM(
        "RENDERED_PAGE",
        name="renderassetkind",
        create_type=False,
    )

    op.create_table(
        "score_revision_sources",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("source_uuid", sa.String(length=36), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("format", revision_source_format, nullable=False),
        sa.Column("storage_backend", sa.String(length=32), nullable=False),
        sa.Column("storage_key", sa.String(length=768), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("generator", sa.String(length=64), nullable=False),
        sa.Column("generator_version", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("revision_id", "format", name="uq_score_revision_sources_revision_format"),
        sa.UniqueConstraint("source_uuid"),
        sa.UniqueConstraint("storage_key", name="uq_score_revision_sources_storage_key"),
    )
    op.create_index(
        "idx_score_revision_sources_revision_format",
        "score_revision_sources",
        ["revision_id", "format"],
        unique=False,
    )

    op.create_table(
        "score_render_assets",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("asset_uuid", sa.String(length=36), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", render_asset_kind, nullable=False),
        sa.Column("storage_backend", sa.String(length=32), nullable=False),
        sa.Column("storage_key", sa.String(length=768), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("render_profile", sa.String(length=128), nullable=True),
        sa.Column("generator", sa.String(length=64), nullable=False),
        sa.Column("generator_version", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "kind != 'RENDERED_PAGE' OR (render_profile IS NOT NULL AND page_number IS NOT NULL)",
            name="ck_score_render_assets_rendered_page_fields",
        ),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("asset_uuid"),
        sa.UniqueConstraint("storage_key", name="uq_score_render_assets_storage_key"),
        sa.UniqueConstraint(
            "revision_id",
            "kind",
            "render_profile",
            "page_number",
            name="uq_score_render_assets_rendered_variant",
        ),
    )
    op.create_index(
        "idx_score_render_assets_revision_kind",
        "score_render_assets",
        ["revision_id", "kind"],
        unique=False,
    )

    bind.execute(
        sa.text(
            """
            INSERT INTO score_revision_sources (
                source_uuid,
                revision_id,
                format,
                storage_backend,
                storage_key,
                filename,
                mime_type,
                size_bytes,
                sha256,
                generator,
                generator_version,
                created_at
            )
            SELECT
                artifact_uuid,
                revision_id,
                'MUSICXML',
                storage_backend,
                storage_key,
                filename,
                mime_type,
                size_bytes,
                sha256,
                generator,
                generator_version,
                created_at
            FROM score_artifacts
            WHERE kind = 'MUSICXML'
            """
        )
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO score_render_assets (
                asset_uuid,
                revision_id,
                kind,
                storage_backend,
                storage_key,
                filename,
                mime_type,
                size_bytes,
                sha256,
                page_number,
                render_profile,
                generator,
                generator_version,
                created_at
            )
            SELECT
                artifact_uuid,
                revision_id,
                'RENDERED_PAGE',
                storage_backend,
                storage_key,
                filename,
                mime_type,
                size_bytes,
                sha256,
                page_number,
                render_profile,
                generator,
                generator_version,
                created_at
            FROM score_artifacts
            WHERE kind = 'RENDERED_PAGE'
            """
        )
    )

    op.drop_index(
        "uq_score_artifacts_canonical_musicxml",
        table_name="score_artifacts",
        postgresql_where=sa.text("kind = 'MUSICXML'"),
        sqlite_where=sa.text("kind = 'MUSICXML'"),
    )
    op.drop_index("idx_score_artifacts_revision_kind", table_name="score_artifacts")
    op.drop_table("score_artifacts")
    sa.Enum(name="artifactkind").drop(bind, checkfirst=True)


def downgrade() -> None:
    bind = op.get_bind()
    sa.Enum("MUSICXML", "RENDERED_PAGE", name="artifactkind").create(bind, checkfirst=True)
    artifact_kind = postgresql.ENUM(
        "MUSICXML",
        "RENDERED_PAGE",
        name="artifactkind",
        create_type=False,
    )
    op.create_table(
        "score_artifacts",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("artifact_uuid", sa.String(length=36), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", artifact_kind, nullable=False),
        sa.Column("storage_backend", sa.String(length=32), nullable=False),
        sa.Column("storage_key", sa.String(length=768), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=False),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=False),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("render_profile", sa.String(length=128), nullable=True),
        sa.Column("generator", sa.String(length=64), nullable=False),
        sa.Column("generator_version", sa.String(length=64), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "kind != 'RENDERED_PAGE' OR (render_profile IS NOT NULL AND page_number IS NOT NULL)",
            name="ck_score_artifacts_rendered_page_fields",
        ),
        sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("artifact_uuid"),
        sa.UniqueConstraint(
            "revision_id",
            "kind",
            "render_profile",
            "page_number",
            name="uq_score_artifacts_rendered_variant",
        ),
        sa.UniqueConstraint("storage_key", name="uq_score_artifacts_storage_key"),
    )
    op.create_index(
        "idx_score_artifacts_revision_kind",
        "score_artifacts",
        ["revision_id", "kind"],
        unique=False,
    )
    op.create_index(
        "uq_score_artifacts_canonical_musicxml",
        "score_artifacts",
        ["revision_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'MUSICXML'"),
        sqlite_where=sa.text("kind = 'MUSICXML'"),
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO score_artifacts (
                artifact_uuid,
                revision_id,
                kind,
                storage_backend,
                storage_key,
                filename,
                mime_type,
                size_bytes,
                sha256,
                page_number,
                render_profile,
                generator,
                generator_version,
                created_at
            )
            SELECT
                source_uuid,
                revision_id,
                'MUSICXML',
                storage_backend,
                storage_key,
                filename,
                mime_type,
                size_bytes,
                sha256,
                NULL,
                NULL,
                generator,
                generator_version,
                created_at
            FROM score_revision_sources
            """
        )
    )
    bind.execute(
        sa.text(
            """
            INSERT INTO score_artifacts (
                artifact_uuid,
                revision_id,
                kind,
                storage_backend,
                storage_key,
                filename,
                mime_type,
                size_bytes,
                sha256,
                page_number,
                render_profile,
                generator,
                generator_version,
                created_at
            )
            SELECT
                asset_uuid,
                revision_id,
                'RENDERED_PAGE',
                storage_backend,
                storage_key,
                filename,
                mime_type,
                size_bytes,
                sha256,
                page_number,
                render_profile,
                generator,
                generator_version,
                created_at
            FROM score_render_assets
            """
        )
    )

    op.drop_index("idx_score_render_assets_revision_kind", table_name="score_render_assets")
    op.drop_table("score_render_assets")
    op.drop_index(
        "idx_score_revision_sources_revision_format",
        table_name="score_revision_sources",
    )
    op.drop_table("score_revision_sources")
    sa.Enum(name="renderassetkind").drop(bind, checkfirst=True)
    sa.Enum(name="revisionsourceformat").drop(bind, checkfirst=True)
