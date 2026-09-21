"""Track take upload finalizing leases and staging cleanup state.

Revision ID: 0057_take_upload_finalizing_cleanup
Revises: 0056_take_auth_and_deletion_outbox
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0057_take_upload_finalizing_cleanup"
down_revision: str | None = "0056_take_auth_and_deletion_outbox"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE = "performance_take_upload_authorizations"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if TABLE not in existing_tables:
        raise RuntimeError(
            f"{TABLE} is required before applying {revision}; "
            "the expected 0056 performance take authorization schema is missing."
        )

    columns = {column["name"] for column in inspector.get_columns(TABLE)}
    if "last_put_url_expires_at" not in columns:
        op.add_column(TABLE, sa.Column("last_put_url_expires_at", sa.DateTime(), nullable=True))
    if "staging_cleanup_after" not in columns:
        op.add_column(TABLE, sa.Column("staging_cleanup_after", sa.DateTime(), nullable=True))
    if "staging_cleanup_completed_at" not in columns:
        op.add_column(TABLE, sa.Column("staging_cleanup_completed_at", sa.DateTime(), nullable=True))
    if "finalizing_token" not in columns:
        op.add_column(TABLE, sa.Column("finalizing_token", sa.String(length=36), nullable=True))
    if "finalizing_expires_at" not in columns:
        op.add_column(TABLE, sa.Column("finalizing_expires_at", sa.DateTime(), nullable=True))

    indexes = {index["name"] for index in inspector.get_indexes(TABLE)}
    if "ix_take_upload_auth_cleanup_after" not in indexes:
        op.create_index(
            "ix_take_upload_auth_cleanup_after",
            TABLE,
            ["staging_cleanup_completed_at", "staging_cleanup_after"],
        )
    if "ix_take_upload_auth_finalizing_expires" not in indexes:
        op.create_index(
            "ix_take_upload_auth_finalizing_expires",
            TABLE,
            ["status", "finalizing_expires_at"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if TABLE not in existing_tables:
        return

    indexes = {index["name"] for index in inspector.get_indexes(TABLE)}
    if "ix_take_upload_auth_finalizing_expires" in indexes:
        op.drop_index("ix_take_upload_auth_finalizing_expires", table_name=TABLE)
    if "ix_take_upload_auth_cleanup_after" in indexes:
        op.drop_index("ix_take_upload_auth_cleanup_after", table_name=TABLE)

    columns = {column["name"] for column in inspector.get_columns(TABLE)}
    for column_name in (
        "finalizing_expires_at",
        "finalizing_token",
        "staging_cleanup_completed_at",
        "staging_cleanup_after",
        "last_put_url_expires_at",
    ):
        if column_name in columns:
            op.drop_column(TABLE, column_name)
