"""add_refresh_tokens

Revision ID: b7e9c2d4a6f1
Revises: 3f4a2b1c9d8e
Create Date: 2026-06-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = "b7e9c2d4a6f1"
down_revision: Union[str, None] = "3f4a2b1c9d8e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "refresh_tokens",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("device_id", sa.String(length=64), nullable=True),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("replaced_by_token_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["replaced_by_token_id"], ["refresh_tokens.id"]),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("idx_refresh_tokens_user_created", "refresh_tokens", ["user_id", "created_at"], unique=False)
    op.create_index("idx_refresh_tokens_expires", "refresh_tokens", ["expires_at"], unique=False)
    op.create_index("idx_refresh_tokens_revoked", "refresh_tokens", ["revoked_at"], unique=False)


def downgrade() -> None:
    op.drop_index("idx_refresh_tokens_revoked", table_name="refresh_tokens")
    op.drop_index("idx_refresh_tokens_expires", table_name="refresh_tokens")
    op.drop_index("idx_refresh_tokens_user_created", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
