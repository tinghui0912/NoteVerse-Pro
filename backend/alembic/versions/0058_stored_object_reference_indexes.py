"""Index semantic StoredObject reference lookups."""

from alembic import op

revision = "0058_stored_object_reference_indexes"
down_revision = "0057_stored_object_retirement"
branch_labels = None
depends_on = None


def upgrade():
    op.create_index("ix_users_avatar_object_id", "users", ["avatar_object_id"], unique=False)


def downgrade():
    op.drop_index("ix_users_avatar_object_id", table_name="users")
