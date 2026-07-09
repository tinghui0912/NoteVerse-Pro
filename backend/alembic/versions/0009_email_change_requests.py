"""email change requests

Revision ID: 0009_email_change_requests
Revises: 0008_pending_registrations
Create Date: 2026-07-09 00:00:00.000000

"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0009_email_change_requests"
down_revision: str | Sequence[str] | None = "0008_pending_registrations"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "email_change_requests",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("user_id", sa.BigInteger(), nullable=False),
        sa.Column("new_email", sa.String(length=255), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("locale", sa.String(length=8), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_email_change_requests_consumed",
        "email_change_requests",
        ["consumed_at"],
        unique=False,
    )
    op.create_index(
        "idx_email_change_requests_expires",
        "email_change_requests",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        "idx_email_change_requests_new_email",
        "email_change_requests",
        ["new_email"],
        unique=False,
    )
    op.create_index(
        "idx_email_change_requests_token_hash",
        "email_change_requests",
        ["token_hash"],
        unique=True,
    )
    op.create_index(
        "idx_email_change_requests_user_created",
        "email_change_requests",
        ["user_id", "created_at"],
        unique=False,
    )


def downgrade() -> None:
    op.drop_index("idx_email_change_requests_user_created", table_name="email_change_requests")
    op.drop_index("idx_email_change_requests_token_hash", table_name="email_change_requests")
    op.drop_index("idx_email_change_requests_new_email", table_name="email_change_requests")
    op.drop_index("idx_email_change_requests_expires", table_name="email_change_requests")
    op.drop_index("idx_email_change_requests_consumed", table_name="email_change_requests")
    op.drop_table("email_change_requests")
