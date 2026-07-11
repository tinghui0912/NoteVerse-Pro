"""allow repeated revision content

Revision ID: 0011_repeat_revision_content
Revises: 0010_playback_assets
Create Date: 2026-07-11 00:00:00.000000

"""

from typing import Sequence

from alembic import op


revision: str = "0011_repeat_revision_content"
down_revision: str | Sequence[str] | None = "0010_playback_assets"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(
        "uq_score_revisions_score_content_hash",
        "score_revisions",
        type_="unique",
    )


def downgrade() -> None:
    op.create_unique_constraint(
        "uq_score_revisions_score_content_hash",
        "score_revisions",
        ["score_id", "content_hash"],
    )
