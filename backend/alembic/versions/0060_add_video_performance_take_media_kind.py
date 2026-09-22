"""Add VIDEO media kind for performance takes.

Revision ID: 0060_add_video_take_media_kind
Revises: 0059_take_upload_candidate_final_keys
Create Date: 2026-09-22 00:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

from alembic import op


revision: str = "0060_add_video_take_media_kind"
down_revision: str | Sequence[str] | None = "0059_take_upload_candidate_final_keys"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE performancetakemediakind ADD VALUE IF NOT EXISTS 'VIDEO'")


def downgrade() -> None:
    # PostgreSQL enum values cannot be removed safely without rebuilding the type.
    pass
