"""Add score deletion lifecycle status.

Revision ID: 0022_score_deletion_status
Revises: 0021_review_preview_kind
Create Date: 2026-07-14 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0022_score_deletion_status"
down_revision: str | None = "0021_review_preview_kind"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


score_deletion_status = postgresql.ENUM(
    "ACTIVE",
    "DELETING",
    "DELETED",
    name="scoredeletionstatus",
)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        score_deletion_status.create(bind, checkfirst=True)

    op.add_column(
        "scores",
        sa.Column(
            "deletion_status",
            sa.Enum("ACTIVE", "DELETING", "DELETED", name="scoredeletionstatus"),
            nullable=False,
            server_default="ACTIVE",
        ),
    )
    op.add_column("scores", sa.Column("deleted_at", sa.DateTime(), nullable=True))
    op.add_column("scores", sa.Column("deletion_requested_at", sa.DateTime(), nullable=True))
    op.add_column("scores", sa.Column("cleanup_completed_at", sa.DateTime(), nullable=True))
    op.create_index(
        "idx_scores_owner_deletion_updated",
        "scores",
        ["owner_user_id", "deletion_status", "updated_at"],
    )
    op.alter_column("scores", "deletion_status", server_default=None)


def downgrade() -> None:
    op.drop_index("idx_scores_owner_deletion_updated", table_name="scores")
    op.drop_column("scores", "cleanup_completed_at")
    op.drop_column("scores", "deletion_requested_at")
    op.drop_column("scores", "deleted_at")
    op.drop_column("scores", "deletion_status")

    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        score_deletion_status.drop(bind, checkfirst=True)
