"""add score invites

Revision ID: fd4e5f6a7b8c
Revises: fc3d4e5f6a7b
Create Date: 2026-07-01 00:00:00.000000
"""

from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = "fd4e5f6a7b8c"
down_revision: Union[str, Sequence[str], None] = "fc3d4e5f6a7b"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    invite_status = postgresql.ENUM(
        "PENDING",
        "ACCEPTED",
        "REVOKED",
        "EXPIRED",
        name="invitestatus",
        create_type=False,
    )
    membership_role = postgresql.ENUM("EDITOR", "VIEWER", name="membershiprole", create_type=False)
    invite_status.create(op.get_bind(), checkfirst=True)

    op.create_table(
        "score_invites",
        sa.Column("id", sa.BigInteger(), autoincrement=True, nullable=False),
        sa.Column("invite_uuid", sa.String(length=36), nullable=False),
        sa.Column("score_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("email", sa.String(length=255), nullable=True),
        sa.Column("role", membership_role, nullable=False),
        sa.Column("status", invite_status, nullable=False),
        sa.Column("created_by_user_id", sa.BigInteger(), nullable=False),
        sa.Column("accepted_by_user_id", sa.BigInteger(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=True),
        sa.Column("accepted_at", sa.DateTime(), nullable=True),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["accepted_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["created_by_user_id"], ["users.id"]),
        sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("invite_uuid"),
    )
    op.create_index("idx_score_invites_email_status", "score_invites", ["email", "status"])
    op.create_index("idx_score_invites_score_created", "score_invites", ["score_id", "created_at"])
    op.create_index("idx_score_invites_token_hash", "score_invites", ["token_hash"], unique=True)


def downgrade() -> None:
    op.drop_index("idx_score_invites_token_hash", table_name="score_invites")
    op.drop_index("idx_score_invites_score_created", table_name="score_invites")
    op.drop_index("idx_score_invites_email_status", table_name="score_invites")
    op.drop_table("score_invites")
    sa.Enum(name="invitestatus").drop(op.get_bind(), checkfirst=True)
