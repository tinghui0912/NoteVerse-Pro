"""Rename review preview import artifact kind.

Revision ID: 0021_review_preview_kind
Revises: 0020_practice_score_cascade
Create Date: 2026-07-14 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op


revision: str = "0021_review_preview_kind"
down_revision: str | None = "0020_practice_score_cascade"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute(
        "UPDATE import_artifacts "
        "SET kind = 'review_preview_image' "
        "WHERE kind = 'result_thumbnail'"
    )


def downgrade() -> None:
    op.execute(
        "UPDATE import_artifacts "
        "SET kind = 'result_thumbnail' "
        "WHERE kind = 'review_preview_image'"
    )
