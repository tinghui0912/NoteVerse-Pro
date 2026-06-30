"""add score domain schema

Revision ID: f1a2b3c4d5e6
Revises: e7f8a9b0c123
Create Date: 2026-06-22 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision: str = "f1a2b3c4d5e6"
down_revision: Union[str, Sequence[str], None] = "e7f8a9b0c123"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "processing_jobs",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("job_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "state",
            sa.Enum(
                "PENDING",
                "PROGRESS",
                "PENDING_REVIEW",
                "SUCCESS",
                "FAILURE",
                name="processingjobstate",
            ),
            nullable=False,
        ),
        sa.Column("progress", sa.Integer(), nullable=False),
        sa.Column("current_step", sa.String(length=64), nullable=True),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column("code", sa.String(length=64), nullable=True),
        sa.Column("error", sa.Text(), nullable=True),
        sa.Column("error_type", sa.String(length=64), nullable=True),
        sa.Column("requested_at", sa.DateTime(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("last_heartbeat_at", sa.DateTime(), nullable=True),
        sa.Column("finished_at", sa.DateTime(), nullable=True),
        sa.Column("score_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("job_uuid"),
        sa.UniqueConstraint(
            "user_id",
            "idempotency_key",
            name="uq_processing_jobs_user_idempotency_key",
        ),
    )
    op.create_index("idx_processing_jobs_state", "processing_jobs", ["state"])
    op.create_index(
        "idx_processing_jobs_user_created",
        "processing_jobs",
        ["user_id", "created_at"],
    )

    op.create_table(
        "scores",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("score_uuid", sa.String(length=36), nullable=False),
        sa.Column("owner_user_id", sa.BigInteger(), nullable=False),
        sa.Column("title", sa.String(length=255), nullable=False),
        sa.Column("difficulty", sa.String(length=32), nullable=True),
        sa.Column(
            "state",
            sa.Enum("IN_REVIEW", "ACTIVE", "ARCHIVED", name="scorestate"),
            nullable=False,
        ),
        sa.Column("head_revision_id", sa.BigInteger(), nullable=True),
        sa.Column("approved_revision_id", sa.BigInteger(), nullable=True),
        sa.Column("originating_job_id", sa.BigInteger(), nullable=True),
        sa.Column("version", sa.Integer(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("version >= 1", name="ck_scores_version_positive"),
        sa.ForeignKeyConstraint(
            ["originating_job_id"],
            ["processing_jobs.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["owner_user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("originating_job_id"),
        sa.UniqueConstraint("score_uuid"),
    )
    op.create_index("idx_scores_owner_updated", "scores", ["owner_user_id", "updated_at"])
    op.create_index("idx_scores_state", "scores", ["state"])

    op.create_table(
        "score_revisions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("revision_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("revision_number", sa.Integer(), nullable=False),
        sa.Column("parent_revision_id", sa.BigInteger(), nullable=True),
        sa.Column("base_revision_id", sa.BigInteger(), nullable=True),
        sa.Column("content_hash", sa.String(length=64), nullable=False),
        sa.Column("idempotency_key", sa.String(length=128), nullable=True),
        sa.Column(
            "origin",
            sa.Enum("OMR", "EDIT", "IMPORT", name="revisionorigin"),
            nullable=False,
        ),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_by_job_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "revision_number >= 1",
            name="ck_score_revisions_number_positive",
        ),
        sa.ForeignKeyConstraint(
            ["score_id", "base_revision_id"],
            ["score_revisions.score_id", "score_revisions.id"],
            name="fk_score_revisions_base",
        ),
        sa.ForeignKeyConstraint(
            ["score_id", "parent_revision_id"],
            ["score_revisions.score_id", "score_revisions.id"],
            name="fk_score_revisions_parent",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_job_id"],
            ["processing_jobs.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(
            ["created_by_user_id"],
            ["users.id"],
            ondelete="SET NULL",
        ),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("revision_uuid"),
        sa.UniqueConstraint(
            "score_id",
            "content_hash",
            name="uq_score_revisions_score_content_hash",
        ),
        sa.UniqueConstraint("score_id", "id", name="uq_score_revisions_score_id_id"),
        sa.UniqueConstraint(
            "score_id",
            "idempotency_key",
            name="uq_score_revisions_score_idempotency_key",
        ),
        sa.UniqueConstraint(
            "score_id",
            "revision_number",
            name="uq_score_revisions_score_number",
        ),
    )
    op.create_index(
        "idx_score_revisions_score_created",
        "score_revisions",
        ["score_id", "created_at"],
    )
    op.create_foreign_key(
        "fk_scores_head_revision",
        "scores",
        "score_revisions",
        ["id", "head_revision_id"],
        ["score_id", "id"],
    )
    op.create_foreign_key(
        "fk_scores_approved_revision",
        "scores",
        "score_revisions",
        ["id", "approved_revision_id"],
        ["score_id", "id"],
    )
    op.create_foreign_key(
        "fk_processing_jobs_score_id",
        "processing_jobs",
        "scores",
        ["score_id"],
        ["id"],
        ondelete="SET NULL",
    )

    op.create_table(
        "processing_job_steps",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("job_id", sa.BigInteger(), nullable=False),
        sa.Column("name", sa.String(length=64), nullable=False),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING",
                "RUNNING",
                "COMPLETED",
                "FAILED",
                name="processingjobstepstatus",
            ),
            nullable=False,
        ),
        sa.Column("start_time", sa.DateTime(), nullable=True),
        sa.Column("end_time", sa.DateTime(), nullable=True),
        sa.Column("step_order", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["processing_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "job_id",
            "name",
            name="uq_processing_job_steps_job_name",
        ),
    )
    op.create_index(
        "idx_processing_job_steps_job_order",
        "processing_job_steps",
        ["job_id", "step_order"],
    )

    op.create_table(
        "processing_artifacts",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("artifact_uuid", sa.String(length=36), nullable=False),
        sa.Column("job_id", sa.BigInteger(), nullable=False),
        sa.Column("kind", sa.String(length=64), nullable=False),
        sa.Column("storage_backend", sa.String(length=32), nullable=False),
        sa.Column("storage_key", sa.String(length=768), nullable=False),
        sa.Column("filename", sa.String(length=255), nullable=False),
        sa.Column("mime_type", sa.String(length=128), nullable=True),
        sa.Column("size_bytes", sa.BigInteger(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("page_number", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["processing_jobs.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("artifact_uuid"),
        sa.UniqueConstraint("storage_key", name="uq_processing_artifacts_storage_key"),
    )
    op.create_index(
        "idx_processing_artifacts_job_kind",
        "processing_artifacts",
        ["job_id", "kind"],
    )

    op.create_table(
        "processing_job_uploads",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("job_id", sa.BigInteger(), nullable=False),
        sa.Column("upload_id", sa.BigInteger(), nullable=False),
        sa.ForeignKeyConstraint(["job_id"], ["processing_jobs.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["upload_id"], ["uploads.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "job_id",
            "upload_id",
            name="uq_processing_job_uploads_job_upload",
        ),
    )
    op.create_index(
        "idx_processing_job_uploads_job",
        "processing_job_uploads",
        ["job_id"],
    )

    op.create_table(
        "score_artifacts",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("artifact_uuid", sa.String(length=36), nullable=False),
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "kind",
            sa.Enum(
                "MUSICXML",
                "RENDERED_PAGE",
                "EXPORT_PDF",
                "AUDIO_PREVIEW",
                "DIAGNOSTIC_JSON",
                name="artifactkind",
            ),
            nullable=False,
        ),
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
            "kind != 'RENDERED_PAGE' OR "
            "(render_profile IS NOT NULL AND page_number IS NOT NULL)",
            name="ck_score_artifacts_rendered_page_fields",
        ),
        sa.ForeignKeyConstraint(
            ["revision_id"],
            ["score_revisions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("artifact_uuid"),
        sa.UniqueConstraint("storage_key", name="uq_score_artifacts_storage_key"),
        sa.UniqueConstraint(
            "revision_id",
            "kind",
            "render_profile",
            "page_number",
            name="uq_score_artifacts_rendered_variant",
        ),
    )
    op.create_index(
        "idx_score_artifacts_revision_kind",
        "score_artifacts",
        ["revision_id", "kind"],
    )
    op.create_index(
        "uq_score_artifacts_canonical_musicxml",
        "score_artifacts",
        ["revision_id"],
        unique=True,
        postgresql_where=sa.text("kind = 'MUSICXML'"),
    )

    op.create_table(
        "score_revision_metadata",
        sa.Column("revision_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("PENDING", "READY", "FAILED", name="metadatastatus"),
            nullable=False,
        ),
        sa.Column("measure_count", sa.Integer(), nullable=True),
        sa.Column("playback_duration_ms", sa.BigInteger(), nullable=True),
        sa.Column("part_count", sa.Integer(), nullable=True),
        sa.Column("primary_key_fifths", sa.Integer(), nullable=True),
        sa.Column("primary_mode", sa.String(length=32), nullable=True),
        sa.Column(
            "key_signature_events",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column(
            "time_signature_events",
            postgresql.JSONB(astext_type=sa.Text()),
            nullable=False,
        ),
        sa.Column("tempo_events", postgresql.JSONB(astext_type=sa.Text()), nullable=False),
        sa.Column("extractor_version", sa.String(length=64), nullable=False),
        sa.Column("error_code", sa.String(length=64), nullable=True),
        sa.Column("computed_at", sa.DateTime(), nullable=True),
        sa.CheckConstraint(
            "status != 'FAILED' OR error_code IS NOT NULL",
            name="ck_score_revision_metadata_failed_with_error",
        ),
        sa.CheckConstraint(
            "status != 'READY' OR error_code IS NULL",
            name="ck_score_revision_metadata_ready_without_error",
        ),
        sa.ForeignKeyConstraint(
            ["revision_id"],
            ["score_revisions.id"],
            ondelete="CASCADE",
        ),
        sa.PrimaryKeyConstraint("revision_id"),
    )
    op.create_index(
        "idx_score_revision_metadata_measure_count",
        "score_revision_metadata",
        ["measure_count"],
    )
    op.create_index(
        "idx_score_revision_metadata_status",
        "score_revision_metadata",
        ["status"],
    )

    op.create_table(
        "score_memberships",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "role",
            sa.Enum("EDITOR", "VIEWER", name="membershiprole"),
            nullable=False,
        ),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "score_id",
            "user_id",
            name="uq_score_memberships_score_user",
        ),
    )
    op.create_index(
        "idx_score_memberships_user_active",
        "score_memberships",
        ["user_id", "revoked_at"],
    )

    op.create_table(
        "score_share_grants",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("grant_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column(
            "scope",
            sa.Enum("VIEW", "EDIT_INVITE", name="sharegrantscope"),
            nullable=False,
        ),
        sa.Column(
            "target_mode",
            sa.Enum("LATEST", "PINNED", name="sharetargetmode"),
            nullable=False,
        ),
        sa.Column("target_revision_id", sa.BigInteger(), nullable=True),
        sa.Column("allow_download", sa.Boolean(), nullable=False),
        sa.Column("allow_practice", sa.Boolean(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint(
            "(target_mode = 'LATEST' AND target_revision_id IS NULL) OR "
            "(target_mode = 'PINNED' AND target_revision_id IS NOT NULL)",
            name="ck_score_share_grants_target",
        ),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(
            ["score_id", "target_revision_id"],
            ["score_revisions.score_id", "score_revisions.id"],
            name="fk_score_share_grants_target_revision",
        ),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("grant_uuid"),
    )
    op.create_index(
        "idx_score_share_grants_score_created",
        "score_share_grants",
        ["score_id", "created_at"],
    )
    op.create_index(
        "idx_score_share_grants_token_hash",
        "score_share_grants",
        ["token_hash"],
        unique=True,
    )

    op.create_table(
        "score_bookmarks",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "score_id",
            "user_id",
            name="uq_score_bookmarks_score_user",
        ),
    )
    op.create_index(
        "idx_score_bookmarks_user_created",
        "score_bookmarks",
        ["user_id", "created_at"],
    )

    op.create_table(
        "share_grant_redemptions",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("grant_id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(
            ["grant_id"],
            ["score_share_grants.id"],
            ondelete="CASCADE",
        ),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint(
            "grant_id",
            "user_id",
            name="uq_share_grant_redemptions_grant_user",
        ),
    )
    op.create_index(
        "idx_share_grant_redemptions_user_created",
        "share_grant_redemptions",
        ["user_id", "created_at"],
    )

    op.create_table(
        "score_publications",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("public_slug", sa.String(length=128), nullable=False),
        sa.Column("published_revision_id", sa.BigInteger(), nullable=False),
        sa.Column(
            "status",
            sa.Enum("PUBLISHED", "UNPUBLISHED", name="publicationstatus"),
            nullable=False,
        ),
        sa.Column(
            "discoverability",
            sa.Enum("LISTED", "UNLISTED", name="publicationdiscoverability"),
            nullable=False,
        ),
        sa.Column("allow_download", sa.Boolean(), nullable=False),
        sa.Column("allow_practice", sa.Boolean(), nullable=False),
        sa.Column("published_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column("published_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["published_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(
            ["score_id", "published_revision_id"],
            ["score_revisions.score_id", "score_revisions.id"],
            name="fk_score_publications_revision",
        ),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("public_slug"),
        sa.UniqueConstraint("score_id"),
    )
    op.create_index(
        "idx_score_publications_status_discoverability",
        "score_publications",
        ["status", "discoverability"],
    )

    access_origin = postgresql.ENUM(
        "OWNER",
        "MEMBERSHIP",
        "SHARE",
        "PUBLICATION",
        name="accessorigin",
        create_type=False,
    )
    postgresql.ENUM(
        "OWNER",
        "MEMBERSHIP",
        "SHARE",
        "PUBLICATION",
        name="accessorigin",
    ).create(op.get_bind(), checkfirst=True)
    op.add_column("practice_sessions", sa.Column("score_id", sa.BigInteger(), nullable=True))
    op.alter_column("practice_sessions", "task_id", existing_type=sa.BigInteger(), nullable=True)
    op.add_column("practice_sessions", sa.Column("revision_id", sa.BigInteger(), nullable=True))
    op.add_column(
        "practice_sessions",
        sa.Column("access_origin", access_origin, nullable=True),
    )
    op.add_column(
        "practice_sessions",
        sa.Column("share_grant_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_practice_sessions_score_id",
        "practice_sessions",
        "scores",
        ["score_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_practice_sessions_revision_id",
        "practice_sessions",
        "score_revisions",
        ["revision_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_foreign_key(
        "fk_practice_sessions_share_grant_id",
        "practice_sessions",
        "score_share_grants",
        ["share_grant_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "idx_practice_sessions_revision_created",
        "practice_sessions",
        ["revision_id", "created_at"],
    )


def downgrade() -> None:
    op.drop_index("idx_practice_sessions_revision_created", table_name="practice_sessions")
    op.drop_constraint(
        "fk_practice_sessions_share_grant_id",
        "practice_sessions",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_practice_sessions_revision_id",
        "practice_sessions",
        type_="foreignkey",
    )
    op.drop_constraint(
        "fk_practice_sessions_score_id",
        "practice_sessions",
        type_="foreignkey",
    )
    op.drop_column("practice_sessions", "share_grant_id")
    op.drop_column("practice_sessions", "access_origin")
    op.drop_column("practice_sessions", "revision_id")
    op.drop_column("practice_sessions", "score_id")
    op.alter_column("practice_sessions", "task_id", existing_type=sa.BigInteger(), nullable=False)

    op.drop_index(
        "idx_score_publications_status_discoverability",
        table_name="score_publications",
    )
    op.drop_table("score_publications")
    op.drop_index(
        "idx_share_grant_redemptions_user_created",
        table_name="share_grant_redemptions",
    )
    op.drop_table("share_grant_redemptions")
    op.drop_index("idx_score_bookmarks_user_created", table_name="score_bookmarks")
    op.drop_table("score_bookmarks")
    op.drop_index("idx_score_share_grants_token_hash", table_name="score_share_grants")
    op.drop_index("idx_score_share_grants_score_created", table_name="score_share_grants")
    op.drop_table("score_share_grants")
    op.drop_index("idx_score_memberships_user_active", table_name="score_memberships")
    op.drop_table("score_memberships")
    op.drop_index(
        "idx_score_revision_metadata_status",
        table_name="score_revision_metadata",
    )
    op.drop_index(
        "idx_score_revision_metadata_measure_count",
        table_name="score_revision_metadata",
    )
    op.drop_table("score_revision_metadata")
    op.drop_index("uq_score_artifacts_canonical_musicxml", table_name="score_artifacts")
    op.drop_index("idx_score_artifacts_revision_kind", table_name="score_artifacts")
    op.drop_table("score_artifacts")
    op.drop_index("idx_processing_job_uploads_job", table_name="processing_job_uploads")
    op.drop_table("processing_job_uploads")
    op.drop_index("idx_processing_artifacts_job_kind", table_name="processing_artifacts")
    op.drop_table("processing_artifacts")
    op.drop_index(
        "idx_processing_job_steps_job_order",
        table_name="processing_job_steps",
    )
    op.drop_table("processing_job_steps")
    op.drop_constraint(
        "fk_processing_jobs_score_id",
        "processing_jobs",
        type_="foreignkey",
    )
    op.drop_constraint("fk_scores_approved_revision", "scores", type_="foreignkey")
    op.drop_constraint("fk_scores_head_revision", "scores", type_="foreignkey")
    op.drop_index("idx_score_revisions_score_created", table_name="score_revisions")
    op.drop_table("score_revisions")
    op.drop_index("idx_scores_state", table_name="scores")
    op.drop_index("idx_scores_owner_updated", table_name="scores")
    op.drop_table("scores")
    op.drop_index("idx_processing_jobs_user_created", table_name="processing_jobs")
    op.drop_index("idx_processing_jobs_state", table_name="processing_jobs")
    op.drop_table("processing_jobs")

    for enum_name in [
        "accessorigin",
        "publicationdiscoverability",
        "publicationstatus",
        "sharetargetmode",
        "sharegrantscope",
        "membershiprole",
        "metadatastatus",
        "artifactkind",
        "processingjobstepstatus",
        "revisionorigin",
        "scorestate",
        "processingjobstate",
    ]:
        sa.Enum(name=enum_name).drop(op.get_bind(), checkfirst=True)
