"""simplify share grants to view-only links

Revision ID: b3c4d5e6f7a8
Revises: a2b3c4d5e6f7
Create Date: 2026-06-23 17:30:00.000000
"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

revision: str = "b3c4d5e6f7a8"
down_revision: Union[str, Sequence[str], None] = "a2b3c4d5e6f7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_column("score_share_grants", "scope")
    sa.Enum(name="sharegrantscope").drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    raise RuntimeError("The view-only share-grant cleanup is intentionally irreversible.")
