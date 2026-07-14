"""cascade practice sessions on score deletion

Revision ID: 0020_practice_score_cascade
Revises: 0019_upload_usage_inputs
Create Date: 2026-07-14 00:00:00.000000

"""

from typing import Sequence

from alembic import op


revision: str = "0020_practice_score_cascade"
down_revision: str | Sequence[str] | None = "0019_upload_usage_inputs"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint("practice_sessions_score_id_fkey", "practice_sessions", type_="foreignkey")
    op.drop_constraint("practice_sessions_revision_id_fkey", "practice_sessions", type_="foreignkey")
    op.create_foreign_key(
        "practice_sessions_score_id_fkey",
        "practice_sessions",
        "scores",
        ["score_id"],
        ["id"],
        ondelete="CASCADE",
    )
    op.create_foreign_key(
        "practice_sessions_revision_id_fkey",
        "practice_sessions",
        "score_revisions",
        ["revision_id"],
        ["id"],
        ondelete="CASCADE",
    )


def downgrade() -> None:
    op.drop_constraint("practice_sessions_score_id_fkey", "practice_sessions", type_="foreignkey")
    op.drop_constraint("practice_sessions_revision_id_fkey", "practice_sessions", type_="foreignkey")
    op.create_foreign_key(
        "practice_sessions_score_id_fkey",
        "practice_sessions",
        "scores",
        ["score_id"],
        ["id"],
    )
    op.create_foreign_key(
        "practice_sessions_revision_id_fkey",
        "practice_sessions",
        "score_revisions",
        ["revision_id"],
        ["id"],
    )
