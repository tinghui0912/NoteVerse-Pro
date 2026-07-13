"""add storage usage accounting

Revision ID: 0016_storage_usage
Revises: 0015_split_assets
Create Date: 2026-07-13 00:00:00.000000

"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0016_storage_usage"
down_revision: str | Sequence[str] | None = "0015_split_assets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FREE_STORAGE_LIMIT_BYTES = 100 * 1024 * 1024


def upgrade() -> None:
    bind = op.get_bind()
    sa.Enum(
        "SOURCE",
        "UPLOAD",
        "DERIVED_RENDER",
        "DERIVED_AUDIO",
        "TEMP_IMPORT",
        name="storageusagecategory",
    ).create(bind, checkfirst=True)
    sa.Enum(
        "RESERVED",
        "COMMITTED",
        "RELEASED",
        name="storageusagereservationstatus",
    ).create(bind, checkfirst=True)
    storage_usage_category = postgresql.ENUM(
        "SOURCE",
        "UPLOAD",
        "DERIVED_RENDER",
        "DERIVED_AUDIO",
        "TEMP_IMPORT",
        name="storageusagecategory",
        create_type=False,
    )
    storage_usage_reservation_status = postgresql.ENUM(
        "RESERVED",
        "COMMITTED",
        "RELEASED",
        name="storageusagereservationstatus",
        create_type=False,
    )

    op.create_table(
        "storage_quota_policies",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("plan_code", sa.String(length=64), nullable=False),
        sa.Column("quota_limit_bytes", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("plan_code"),
    )
    op.create_table(
        "storage_usage_accounts",
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("plan_code", sa.String(length=64), nullable=False),
        sa.Column("used_bytes", sa.BigInteger(), nullable=False),
        sa.Column("reserved_bytes", sa.BigInteger(), nullable=False),
        sa.Column("quota_limit_bytes", sa.BigInteger(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("used_bytes >= 0", name="ck_storage_usage_accounts_used_non_negative"),
        sa.CheckConstraint("reserved_bytes >= 0", name="ck_storage_usage_accounts_reserved_non_negative"),
        sa.CheckConstraint("quota_limit_bytes >= 0", name="ck_storage_usage_accounts_limit_non_negative"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("user_id"),
    )
    op.create_table(
        "storage_usage_counters",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("category", storage_usage_category, nullable=False),
        sa.Column("used_bytes", sa.BigInteger(), nullable=False),
        sa.Column("reserved_bytes", sa.BigInteger(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("used_bytes >= 0", name="ck_storage_usage_counters_used_non_negative"),
        sa.CheckConstraint("reserved_bytes >= 0", name="ck_storage_usage_counters_reserved_non_negative"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "category", name="uq_storage_usage_counters_user_category"),
    )
    op.create_index("idx_storage_usage_counters_user", "storage_usage_counters", ["user_id"])
    op.create_table(
        "storage_usage_reservations",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("reservation_uuid", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("category", storage_usage_category, nullable=False),
        sa.Column("bytes_reserved", sa.BigInteger(), nullable=False),
        sa.Column("counts_toward_quota", sa.Boolean(), nullable=False),
        sa.Column("status", storage_usage_reservation_status, nullable=False),
        sa.Column("reason", sa.String(length=64), nullable=False),
        sa.Column("object_type", sa.String(length=64), nullable=True),
        sa.Column("object_id", sa.String(length=128), nullable=True),
        sa.Column("storage_key", sa.String(length=768), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("bytes_reserved >= 0", name="ck_storage_usage_reservations_bytes_non_negative"),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("reservation_uuid"),
    )
    op.create_index(
        "idx_storage_usage_reservations_user_status",
        "storage_usage_reservations",
        ["user_id", "status"],
    )
    op.create_table(
        "storage_usage_events",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("category", storage_usage_category, nullable=False),
        sa.Column("delta_bytes", sa.BigInteger(), nullable=False),
        sa.Column("counts_toward_quota", sa.Boolean(), nullable=False),
        sa.Column("reason", sa.String(length=64), nullable=False),
        sa.Column("object_type", sa.String(length=64), nullable=True),
        sa.Column("object_id", sa.String(length=128), nullable=True),
        sa.Column("storage_key", sa.String(length=768), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_storage_usage_events_user_created",
        "storage_usage_events",
        ["user_id", "created_at"],
    )
    op.create_index(
        "idx_storage_usage_events_object",
        "storage_usage_events",
        ["object_type", "object_id"],
    )

    op.execute(
        sa.text(
            """
            INSERT INTO storage_quota_policies (plan_code, quota_limit_bytes, created_at, updated_at)
            VALUES ('FREE', :limit, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            """
        ).bindparams(limit=FREE_STORAGE_LIMIT_BYTES)
    )
    _backfill_usage()


def downgrade() -> None:
    op.drop_index("idx_storage_usage_events_object", table_name="storage_usage_events")
    op.drop_index("idx_storage_usage_events_user_created", table_name="storage_usage_events")
    op.drop_table("storage_usage_events")
    op.drop_index("idx_storage_usage_reservations_user_status", table_name="storage_usage_reservations")
    op.drop_table("storage_usage_reservations")
    op.drop_index("idx_storage_usage_counters_user", table_name="storage_usage_counters")
    op.drop_table("storage_usage_counters")
    op.drop_table("storage_usage_accounts")
    op.drop_table("storage_quota_policies")
    sa.Enum(name="storageusagereservationstatus").drop(op.get_bind(), checkfirst=True)
    sa.Enum(name="storageusagecategory").drop(op.get_bind(), checkfirst=True)


def _backfill_usage() -> None:
    account_usage_sql = """
        WITH source_usage AS (
            SELECT s.owner_user_id AS user_id, COALESCE(SUM(src.size_bytes), 0) AS bytes
            FROM score_revision_sources src
            JOIN score_revisions r ON r.id = src.revision_id
            JOIN scores s ON s.id = r.score_id
            GROUP BY s.owner_user_id
        ),
        upload_usage AS (
            SELECT uploader_user_id AS user_id, COALESCE(SUM(size_bytes), 0) AS bytes
            FROM uploads
            WHERE uploader_user_id IS NOT NULL
            GROUP BY uploader_user_id
        ),
        quota_usage AS (
            SELECT user_id, SUM(bytes) AS bytes
            FROM (
                SELECT * FROM source_usage
                UNION ALL
                SELECT * FROM upload_usage
            ) rows
            GROUP BY user_id
        )
        INSERT INTO storage_usage_accounts (
            user_id, plan_code, used_bytes, reserved_bytes, quota_limit_bytes, created_at, updated_at
        )
        SELECT
            users.id,
            'FREE',
            COALESCE(quota_usage.bytes, 0),
            0,
            :limit,
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        FROM users
        LEFT JOIN quota_usage ON quota_usage.user_id = users.id
    """
    op.execute(sa.text(account_usage_sql).bindparams(limit=FREE_STORAGE_LIMIT_BYTES))
    counter_sql = """
        INSERT INTO storage_usage_counters (user_id, category, used_bytes, reserved_bytes, updated_at)
        SELECT user_id, category, SUM(bytes), 0, CURRENT_TIMESTAMP
        FROM (
            SELECT s.owner_user_id AS user_id, 'SOURCE'::storageusagecategory AS category, COALESCE(src.size_bytes, 0) AS bytes
            FROM score_revision_sources src
            JOIN score_revisions r ON r.id = src.revision_id
            JOIN scores s ON s.id = r.score_id
            UNION ALL
            SELECT uploader_user_id AS user_id, 'UPLOAD'::storageusagecategory AS category, COALESCE(size_bytes, 0) AS bytes
            FROM uploads
            WHERE uploader_user_id IS NOT NULL
            UNION ALL
            SELECT s.owner_user_id AS user_id, 'DERIVED_RENDER'::storageusagecategory AS category, COALESCE(asset.size_bytes, 0) AS bytes
            FROM score_render_assets asset
            JOIN score_revisions r ON r.id = asset.revision_id
            JOIN scores s ON s.id = r.score_id
            UNION ALL
            SELECT s.owner_user_id AS user_id, 'DERIVED_AUDIO'::storageusagecategory AS category, COALESCE(asset.size_bytes, 0) AS bytes
            FROM score_playback_assets asset
            JOIN score_revisions r ON r.id = asset.revision_id
            JOIN scores s ON s.id = r.score_id
            UNION ALL
            SELECT job.user_id AS user_id, 'TEMP_IMPORT'::storageusagecategory AS category, COALESCE(artifact.size_bytes, 0) AS bytes
            FROM import_artifacts artifact
            JOIN import_jobs job ON job.id = artifact.job_id
        ) rows
        WHERE user_id IS NOT NULL
        GROUP BY user_id, category
    """
    op.execute(sa.text(counter_sql))
