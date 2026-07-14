"""rebuild storage usage ownership

Revision ID: 0018_storage_owner_usage
Revises: 0017_storage_blobs
Create Date: 2026-07-14 00:00:00.000000

"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0018_storage_owner_usage"
down_revision: str | Sequence[str] | None = "0017_storage_blobs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

FREE_STORAGE_LIMIT_BYTES = 100 * 1024 * 1024


def upgrade() -> None:
    _ensure_accounts()
    _rebuild_counters()
    _rebuild_account_used_bytes()


def downgrade() -> None:
    # Usage counters are derived from current resource ownership; do not restore
    # historical creator-based attribution.
    pass


def _ensure_accounts() -> None:
    op.execute(
        sa.text(
            """
            INSERT INTO storage_usage_accounts (
                user_id, plan_code, used_bytes, reserved_bytes, quota_limit_bytes, created_at, updated_at
            )
            SELECT users.id, 'FREE', 0, 0, :limit, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
            FROM users
            WHERE NOT EXISTS (
                SELECT 1 FROM storage_usage_accounts account WHERE account.user_id = users.id
            )
            """
        ).bindparams(limit=FREE_STORAGE_LIMIT_BYTES)
    )


def _rebuild_counters() -> None:
    op.execute("UPDATE storage_usage_counters SET used_bytes = 0, updated_at = CURRENT_TIMESTAMP")
    op.execute(
        sa.text(
            """
            WITH usage_rows AS (
                SELECT
                    scores.owner_user_id AS user_id,
                    'SOURCE'::storageusagecategory AS category,
                    COALESCE(source.size_bytes, 0) AS bytes
                FROM score_revision_sources source
                JOIN score_revisions revision ON revision.id = source.revision_id
                JOIN scores ON scores.id = revision.score_id

                UNION ALL

                SELECT
                    uploads.uploader_user_id AS user_id,
                    'UPLOAD'::storageusagecategory AS category,
                    COALESCE(blob.size_bytes, 0) AS bytes
                FROM uploads
                JOIN storage_blobs blob ON blob.id = uploads.blob_id
                LEFT JOIN score_input_assets input_asset ON input_asset.upload_id = uploads.id
                WHERE uploads.uploader_user_id IS NOT NULL
                  AND input_asset.id IS NULL

                UNION ALL

                SELECT
                    scores.owner_user_id AS user_id,
                    'INPUT_ASSET'::storageusagecategory AS category,
                    COALESCE(blob.size_bytes, 0) AS bytes
                FROM score_input_assets input_asset
                JOIN scores ON scores.id = input_asset.score_id
                JOIN uploads ON uploads.id = input_asset.upload_id
                JOIN storage_blobs blob ON blob.id = uploads.blob_id

                UNION ALL

                SELECT
                    scores.owner_user_id AS user_id,
                    'DERIVED_RENDER'::storageusagecategory AS category,
                    COALESCE(asset.size_bytes, 0) AS bytes
                FROM score_render_assets asset
                JOIN score_revisions revision ON revision.id = asset.revision_id
                JOIN scores ON scores.id = revision.score_id

                UNION ALL

                SELECT
                    scores.owner_user_id AS user_id,
                    'DERIVED_AUDIO'::storageusagecategory AS category,
                    COALESCE(asset.size_bytes, 0) AS bytes
                FROM score_playback_assets asset
                JOIN score_revisions revision ON revision.id = asset.revision_id
                JOIN scores ON scores.id = revision.score_id

                UNION ALL

                SELECT
                    job.user_id AS user_id,
                    'TEMP_IMPORT'::storageusagecategory AS category,
                    COALESCE(artifact.size_bytes, 0) AS bytes
                FROM import_artifacts artifact
                JOIN import_jobs job ON job.id = artifact.job_id
            ),
            totals AS (
                SELECT user_id, category, SUM(bytes) AS used_bytes
                FROM usage_rows
                WHERE user_id IS NOT NULL
                GROUP BY user_id, category
            )
            INSERT INTO storage_usage_counters (
                user_id, category, used_bytes, reserved_bytes, updated_at
            )
            SELECT user_id, category, used_bytes, 0, CURRENT_TIMESTAMP
            FROM totals
            ON CONFLICT (user_id, category)
            DO UPDATE SET used_bytes = EXCLUDED.used_bytes, updated_at = CURRENT_TIMESTAMP
            """
        )
    )


def _rebuild_account_used_bytes() -> None:
    op.execute(
        """
        WITH quota_totals AS (
            SELECT user_id, COALESCE(SUM(used_bytes), 0) AS used_bytes
            FROM storage_usage_counters
            WHERE category IN ('SOURCE', 'UPLOAD', 'INPUT_ASSET')
            GROUP BY user_id
        )
        UPDATE storage_usage_accounts account
        SET
            used_bytes = COALESCE(quota_totals.used_bytes, 0),
            updated_at = CURRENT_TIMESTAMP
        FROM quota_totals
        WHERE quota_totals.user_id = account.user_id
        """
    )
    op.execute(
        """
        UPDATE storage_usage_accounts account
        SET used_bytes = 0, updated_at = CURRENT_TIMESTAMP
        WHERE NOT EXISTS (
            SELECT 1
            FROM storage_usage_counters counter
            WHERE counter.user_id = account.user_id
              AND counter.category IN ('SOURCE', 'UPLOAD', 'INPUT_ASSET')
              AND counter.used_bytes > 0
        )
        """
    )
