"""remove archive features

Revision ID: fa1b2c3d4e5f
Revises: f9a0b1c2d3e4
Create Date: 2026-06-27 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "fa1b2c3d4e5f"
down_revision: Union[str, Sequence[str], None] = "f9a0b1c2d3e4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


score_state_enum = postgresql.ENUM(
    "IN_REVIEW",
    "ACTIVE",
    "ARCHIVED",
    name="scorestate",
    create_type=False,
)


def upgrade() -> None:
    op.drop_column("score_library_entries", "is_archived")
    op.drop_column("scores", "archived_from_state")
    if op.get_bind().dialect.name == "postgresql":
        op.execute("UPDATE scores SET state = 'ACTIVE' WHERE state = 'ARCHIVED'")
        op.execute("ALTER TYPE scorestate RENAME TO scorestate_old")
        op.execute("CREATE TYPE scorestate AS ENUM ('IN_REVIEW', 'ACTIVE')")
        op.execute(
            "ALTER TABLE scores ALTER COLUMN state TYPE scorestate "
            "USING state::text::scorestate"
        )
        op.execute("DROP TYPE scorestate_old")


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("ALTER TYPE scorestate RENAME TO scorestate_old")
        op.execute("CREATE TYPE scorestate AS ENUM ('IN_REVIEW', 'ACTIVE', 'ARCHIVED')")
        op.execute(
            "ALTER TABLE scores ALTER COLUMN state TYPE scorestate "
            "USING state::text::scorestate"
        )
        op.execute("DROP TYPE scorestate_old")
    op.add_column(
        "scores",
        sa.Column("archived_from_state", score_state_enum, nullable=True),
    )
    op.add_column(
        "score_library_entries",
        sa.Column(
            "is_archived",
            sa.Boolean(),
            server_default=sa.false(),
            nullable=False,
        ),
    )
    op.alter_column("score_library_entries", "is_archived", server_default=None)
