"""Attach generated playback assets to immutable execution provenance.

Revision ID: 0040_playback_exec_manifest
Revises: 0039_render_exec_manifest
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0040_playback_exec_manifest"
down_revision: str | None = "0039_render_exec_manifest"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column(
        "score_playback_assets",
        sa.Column("execution_manifest_id", sa.BigInteger(), nullable=True),
    )
    op.create_foreign_key(
        "fk_score_playback_assets_execution_manifest_id",
        "score_playback_assets",
        "execution_manifests",
        ["execution_manifest_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index(
        "ix_score_playback_assets_execution_manifest_id",
        "score_playback_assets",
        ["execution_manifest_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_score_playback_assets_execution_manifest_id", table_name="score_playback_assets"
    )
    op.drop_constraint(
        "fk_score_playback_assets_execution_manifest_id",
        "score_playback_assets",
        type_="foreignkey",
    )
    op.drop_column("score_playback_assets", "execution_manifest_id")
