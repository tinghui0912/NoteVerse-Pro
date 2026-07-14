"""rebuild upload usage excluding score inputs

Revision ID: 0019_upload_usage_inputs
Revises: 0018_storage_owner_usage
Create Date: 2026-07-14 00:00:00.000000

"""

from typing import Sequence

from alembic import op


revision: str = "0019_upload_usage_inputs"
down_revision: str | Sequence[str] | None = "0018_storage_owner_usage"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    _rebuild_upload_counter()
    _rebuild_account_used_bytes()


def downgrade() -> None:
    # Usage counters are derived state. Do not restore the previous duplicate
    # accounting where a promoted upload also counted as an input asset.
    pass


def _rebuild_upload_counter() -> None:
    op.execute(
        """
        WITH upload_totals AS (
            SELECT
                uploads.uploader_user_id AS user_id,
                COALESCE(SUM(blob.size_bytes), 0) AS used_bytes
            FROM uploads
            JOIN storage_blobs blob ON blob.id = uploads.blob_id
            LEFT JOIN score_input_assets input_asset ON input_asset.upload_id = uploads.id
            WHERE uploads.uploader_user_id IS NOT NULL
              AND input_asset.id IS NULL
            GROUP BY uploads.uploader_user_id
        )
        INSERT INTO storage_usage_counters (
            user_id, category, used_bytes, reserved_bytes, updated_at
        )
        SELECT
            user_id,
            'UPLOAD'::storageusagecategory,
            used_bytes,
            0,
            CURRENT_TIMESTAMP
        FROM upload_totals
        ON CONFLICT (user_id, category)
        DO UPDATE SET
            used_bytes = EXCLUDED.used_bytes,
            updated_at = CURRENT_TIMESTAMP
        """
    )
    op.execute(
        """
        UPDATE storage_usage_counters counter
        SET used_bytes = 0, updated_at = CURRENT_TIMESTAMP
        WHERE counter.category = 'UPLOAD'
          AND NOT EXISTS (
              SELECT 1
              FROM uploads
              JOIN storage_blobs blob ON blob.id = uploads.blob_id
              LEFT JOIN score_input_assets input_asset ON input_asset.upload_id = uploads.id
              WHERE uploads.uploader_user_id = counter.user_id
                AND uploads.uploader_user_id IS NOT NULL
                AND input_asset.id IS NULL
          )
        """
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
