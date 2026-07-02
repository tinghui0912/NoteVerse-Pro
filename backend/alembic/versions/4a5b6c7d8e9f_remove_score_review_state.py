"""Remove Score review state.

Revision ID: 4a5b6c7d8e9f
Revises: 2c3d4e5f6a7b
Create Date: 2026-07-02 00:00:00.000000
"""

from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "4a5b6c7d8e9f"
down_revision: str | Sequence[str] | None = "2c3d4e5f6a7b"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    op.execute("UPDATE scores SET state = 'ACTIVE' WHERE state = 'IN_REVIEW'")
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE scores ALTER COLUMN state TYPE text USING state::text")
        op.execute("DROP TYPE scorestate")
        op.execute("CREATE TYPE scorestate AS ENUM ('ACTIVE')")
        op.execute(
            "ALTER TABLE scores ALTER COLUMN state TYPE scorestate USING state::scorestate"
        )
    else:
        with op.batch_alter_table("scores") as batch_op:
            batch_op.alter_column(
                "state",
                existing_type=sa.Enum("IN_REVIEW", "ACTIVE", name="scorestate"),
                type_=sa.Enum("ACTIVE", name="scorestate"),
                existing_nullable=False,
            )


def downgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        op.execute("ALTER TABLE scores ALTER COLUMN state TYPE text USING state::text")
        op.execute("DROP TYPE scorestate")
        op.execute("CREATE TYPE scorestate AS ENUM ('IN_REVIEW', 'ACTIVE')")
        op.execute(
            "ALTER TABLE scores ALTER COLUMN state TYPE scorestate USING state::scorestate"
        )
    else:
        with op.batch_alter_table("scores") as batch_op:
            batch_op.alter_column(
                "state",
                existing_type=sa.Enum("ACTIVE", name="scorestate"),
                type_=sa.Enum("IN_REVIEW", "ACTIVE", name="scorestate"),
                existing_nullable=False,
            )
