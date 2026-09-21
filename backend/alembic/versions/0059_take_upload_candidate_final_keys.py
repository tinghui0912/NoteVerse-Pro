"""Track candidate final objects for take upload finalizing leases.

Revision ID: 0059_take_upload_candidate_final_keys
Revises: 0058_take_upload_cleanup_completion
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0059_take_upload_candidate_final_keys"
down_revision: str | None = "0058_take_upload_cleanup_completion"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE = "performance_take_upload_authorizations"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE not in set(inspector.get_table_names()):
        raise RuntimeError(
            f"{TABLE} is required before applying {revision}; "
            "the expected take upload authorization schema is missing."
        )

    columns = {column["name"] for column in inspector.get_columns(TABLE)}
    if "finalizing_object_key" not in columns:
        op.add_column(TABLE, sa.Column("finalizing_object_key", sa.String(length=768), nullable=True))
    if "orphan_final_object_keys" not in columns:
        op.add_column(TABLE, sa.Column("orphan_final_object_keys", sa.Text(), nullable=True))


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    if TABLE not in set(inspector.get_table_names()):
        return

    columns = {column["name"] for column in inspector.get_columns(TABLE)}
    if "orphan_final_object_keys" in columns:
        op.drop_column(TABLE, "orphan_final_object_keys")
    if "finalizing_object_key" in columns:
        op.drop_column(TABLE, "finalizing_object_key")
