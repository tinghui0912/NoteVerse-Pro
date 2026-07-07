"""add durable transactional mail outbox

Revision ID: 0006_mail_outbox
Revises: 0005_generalize_render_outbox
Create Date: 2026-07-07
"""

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0006_mail_outbox"
down_revision: str | Sequence[str] | None = "0005_generalize_render_outbox"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.create_table(
        "mail_outbox",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            autoincrement=True,
            nullable=False,
        ),
        sa.Column("outbox_uuid", sa.String(36), nullable=False),
        sa.Column("category", sa.String(64), nullable=False),
        sa.Column("dedupe_key", sa.String(160), nullable=False),
        sa.Column("recipient", sa.String(320), nullable=False),
        sa.Column("subject", sa.String(255), nullable=False),
        sa.Column("text_body", sa.Text(), nullable=True),
        sa.Column("html_body", sa.Text(), nullable=True),
        sa.Column(
            "status",
            sa.Enum(
                "PENDING",
                "DISPATCHED",
                "PROCESSING",
                "SENT",
                "FAILED",
                "PERMANENT_FAILURE",
                "EXPIRED",
                name="mailoutboxstatus",
            ),
            nullable=False,
        ),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("dispatched_at", sa.DateTime(), nullable=True),
        sa.Column("started_at", sa.DateTime(), nullable=True),
        sa.Column("completed_at", sa.DateTime(), nullable=True),
        sa.Column("provider_message_id", sa.String(128), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.CheckConstraint("attempt_count >= 0", name="ck_mail_outbox_attempt_count"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("dedupe_key"),
        sa.UniqueConstraint("outbox_uuid"),
    )
    op.create_index(
        "idx_mail_outbox_status_available",
        "mail_outbox",
        ["status", "next_attempt_at"],
    )
    op.create_index(
        "idx_mail_outbox_dispatched",
        "mail_outbox",
        ["status", "dispatched_at"],
    )
    op.create_index("idx_mail_outbox_created", "mail_outbox", ["created_at"])


def downgrade() -> None:
    op.drop_index("idx_mail_outbox_created", table_name="mail_outbox")
    op.drop_index("idx_mail_outbox_dispatched", table_name="mail_outbox")
    op.drop_index("idx_mail_outbox_status_available", table_name="mail_outbox")
    op.drop_table("mail_outbox")
    sa.Enum(name="mailoutboxstatus").drop(op.get_bind(), checkfirst=True)
