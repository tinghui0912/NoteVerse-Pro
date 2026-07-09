"""auth email link tokens

Revision ID: 0007_auth_email_link_tokens
Revises: 0006_mail_outbox
Create Date: 2026-07-09 00:00:00.000000

"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0007_auth_email_link_tokens"
down_revision: str | Sequence[str] | None = "0006_mail_outbox"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column("users", sa.Column("email_verified_at", sa.DateTime(), nullable=True))
    op.execute("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL")

    op.create_table(
        "auth_tokens",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("purpose", sa.String(length=64), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("used_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("idx_auth_tokens_expires", "auth_tokens", ["expires_at"], unique=False)
    op.create_index("idx_auth_tokens_used", "auth_tokens", ["used_at"], unique=False)
    op.create_index(
        "idx_auth_tokens_user_purpose",
        "auth_tokens",
        ["user_id", "purpose"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_auth_tokens_user_purpose", table_name="auth_tokens")
    op.drop_index("idx_auth_tokens_used", table_name="auth_tokens")
    op.drop_index("idx_auth_tokens_expires", table_name="auth_tokens")
    op.drop_table("auth_tokens")
    op.drop_column("users", "email_verified_at")
