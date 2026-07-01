"""Add declined score invites.

Revision ID: 0a1b2c3d4e5f
Revises: fd4e5f6a7b8c
Create Date: 2026-07-01 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0a1b2c3d4e5f"
down_revision: str | Sequence[str] | None = "fd4e5f6a7b8c"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("ALTER TYPE invitestatus ADD VALUE IF NOT EXISTS 'DECLINED'")
    op.add_column("score_invites", sa.Column("declined_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    op.drop_column("score_invites", "declined_at")
