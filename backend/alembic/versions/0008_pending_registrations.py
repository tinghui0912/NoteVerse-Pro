"""pending registrations

Revision ID: 0008_pending_registrations
Revises: 0007_auth_email_link_tokens
Create Date: 2026-07-09 00:00:00.000000

"""
from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0008_pending_registrations"
down_revision: str | Sequence[str] | None = "0007_auth_email_link_tokens"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("DELETE FROM auth_tokens WHERE purpose = 'email_verification'")
    op.execute("DELETE FROM users WHERE email_verified_at IS NULL")
    op.alter_column(
        "users",
        "email_verified_at",
        existing_type=sa.DateTime(),
        nullable=False,
    )

    op.create_table(
        "pending_registrations",
        sa.Column("id", sa.BigInteger(), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("resend_count", sa.Integer(), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("consumed_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "idx_pending_registrations_consumed",
        "pending_registrations",
        ["consumed_at"],
        unique=False,
    )
    op.create_index(
        "idx_pending_registrations_email",
        "pending_registrations",
        ["email"],
        unique=True,
    )
    op.create_index(
        "idx_pending_registrations_expires",
        "pending_registrations",
        ["expires_at"],
        unique=False,
    )
    op.create_index(
        "idx_pending_registrations_token_hash",
        "pending_registrations",
        ["token_hash"],
        unique=True,
    )


def downgrade() -> None:
    op.drop_index("idx_pending_registrations_token_hash", table_name="pending_registrations")
    op.drop_index("idx_pending_registrations_expires", table_name="pending_registrations")
    op.drop_index("idx_pending_registrations_email", table_name="pending_registrations")
    op.drop_index("idx_pending_registrations_consumed", table_name="pending_registrations")
    op.drop_table("pending_registrations")
    op.alter_column(
        "users",
        "email_verified_at",
        existing_type=sa.DateTime(),
        nullable=True,
    )
