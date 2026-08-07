"""Remove the obsolete customer-wide authorization role.

Revision ID: 0037_remove_customer_user_role
Revises: 0036_async_trace_context
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0037_remove_customer_user_role"
down_revision: str | None = "0036_async_trace_context"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


USER_ROLE_ENUM = sa.Enum("user", "admin", name="userrole")


def upgrade() -> None:
    """Keep platform authorization solely on the operator identity boundary."""
    op.drop_column("users", "role")
    USER_ROLE_ENUM.drop(op.get_bind(), checkfirst=True)


def downgrade() -> None:
    """Restore the legacy column only for an explicit migration rollback."""
    bind = op.get_bind()
    USER_ROLE_ENUM.create(bind, checkfirst=True)
    op.add_column(
        "users",
        sa.Column(
            "role",
            USER_ROLE_ENUM,
            nullable=False,
            server_default=sa.text("'user'"),
        ),
    )
    op.alter_column("users", "role", server_default=None)
