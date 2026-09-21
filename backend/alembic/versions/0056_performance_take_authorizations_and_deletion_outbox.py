"""Add performance_take_upload_authorizations, take deletion_status, and deletion_outbox.

Revision ID: 0056_take_auth_and_deletion_outbox
Revises: 0055_performance_take_fk_and_scope_fix
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0056_take_auth_and_deletion_outbox"
down_revision: str | None = "0055_performance_take_fk_and_scope_fix"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    # 1. Create performance_take_upload_authorizations table
    if "performance_take_upload_authorizations" not in existing_tables:
        op.create_table(
            "performance_take_upload_authorizations",
            sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
            sa.Column("auth_uuid", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("client_request_id", sa.String(length=128), nullable=False),
            sa.Column("take_uuid", sa.String(length=36), nullable=False),
            sa.Column("score_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), sa.ForeignKey("scores.id", ondelete="SET NULL"), nullable=True),
            sa.Column("score_uuid", sa.String(length=36), nullable=True),
            sa.Column("score_title", sa.String(length=255), nullable=True),
            sa.Column("revision_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), sa.ForeignKey("score_revisions.id", ondelete="SET NULL"), nullable=True),
            sa.Column("revision_uuid", sa.String(length=36), nullable=True),
            sa.Column("artifact_id", sa.String(length=128), nullable=True),
            sa.Column("scope_type", sa.String(length=16), nullable=False, server_default="FULL"),
            sa.Column("scope_start_beat", sa.Float(), nullable=False),
            sa.Column("scope_terminal_beat", sa.Float(), nullable=False),
            sa.Column("tempo_selection", sa.Text(), nullable=True),
            sa.Column("resolved_tempo_plan", sa.Text(), nullable=True),
            sa.Column("sync_metadata", sa.Text(), nullable=True),
            sa.Column("duration_ms", sa.Integer(), nullable=False),
            sa.Column("media_kind", sa.String(length=16), nullable=False, server_default="AUDIO"),
            sa.Column("media_mime_type", sa.String(length=64), nullable=False),
            sa.Column("media_byte_size", sa.BigInteger(), nullable=False),
            sa.Column("storage_backend", sa.String(length=32), nullable=False),
            sa.Column("staging_object_key", sa.String(length=768), nullable=False),
            sa.Column("final_object_key", sa.String(length=768), nullable=False),
            sa.Column("reservation_id", sa.String(length=36), nullable=False),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="AUTHORIZED"),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
            sa.UniqueConstraint("user_id", "client_request_id", name="uq_take_upload_auth_user_client_request_id"),
        )
        op.create_index("ix_take_upload_auth_auth_uuid", "performance_take_upload_authorizations", ["auth_uuid"], unique=True)
        op.create_index("ix_take_upload_auth_user_id", "performance_take_upload_authorizations", ["user_id"])
        op.create_index("ix_take_upload_auth_take_uuid", "performance_take_upload_authorizations", ["take_uuid"])
        op.create_index("ix_take_upload_auth_reservation_id", "performance_take_upload_authorizations", ["reservation_id"])
        op.create_index("ix_take_upload_auth_status_expires", "performance_take_upload_authorizations", ["status", "expires_at"])

    # 2. Add deletion_status to performance_takes
    if "performance_takes" in existing_tables:
        columns = [c["name"] for c in inspector.get_columns("performance_takes")]
        if "deletion_status" not in columns:
            op.add_column(
                "performance_takes",
                sa.Column("deletion_status", sa.String(length=16), nullable=False, server_default="ACTIVE"),
            )
            op.create_index("ix_performance_takes_user_deletion_status", "performance_takes", ["user_id", "deletion_status"])

    # 3. Create performance_take_delete_outbox table
    if "performance_take_delete_outbox" not in existing_tables:
        op.create_table(
            "performance_take_delete_outbox",
            sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
            sa.Column("outbox_uuid", sa.String(length=36), nullable=False),
            sa.Column("take_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), sa.ForeignKey("performance_takes.id", ondelete="SET NULL"), nullable=True),
            sa.Column("take_uuid", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), sa.ForeignKey("users.id", ondelete="CASCADE"), nullable=False),
            sa.Column("storage_backend", sa.String(length=32), nullable=False),
            sa.Column("object_key", sa.String(length=768), nullable=False),
            sa.Column("media_byte_size", sa.BigInteger(), nullable=False),
            sa.Column("status", sa.String(length=24), nullable=False, server_default="PENDING"),
            sa.Column("attempt_count", sa.Integer(), nullable=False, server_default="0"),
            sa.Column("max_attempts", sa.Integer(), nullable=False, server_default="5"),
            sa.Column("next_attempt_at", sa.DateTime(), nullable=False),
            sa.Column("started_at", sa.DateTime(), nullable=True),
            sa.Column("dispatched_at", sa.DateTime(), nullable=True),
            sa.Column("completed_at", sa.DateTime(), nullable=True),
            sa.Column("last_error", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=False),
            sa.Column("updated_at", sa.DateTime(), nullable=False),
        )
        op.create_index("ix_take_delete_outbox_outbox_uuid", "performance_take_delete_outbox", ["outbox_uuid"], unique=True)
        op.create_index("ix_take_delete_outbox_take_uuid", "performance_take_delete_outbox", ["take_uuid"], unique=True)
        op.create_index("ix_take_delete_outbox_user_id", "performance_take_delete_outbox", ["user_id"])
        op.create_index("ix_take_delete_outbox_status_next_attempt", "performance_take_delete_outbox", ["status", "next_attempt_at"])


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())

    if "performance_take_delete_outbox" in existing_tables:
        op.drop_table("performance_take_delete_outbox")

    if "performance_takes" in existing_tables:
        columns = [c["name"] for c in inspector.get_columns("performance_takes")]
        if "deletion_status" in columns:
            op.drop_index("ix_performance_takes_user_deletion_status", table_name="performance_takes")
            op.drop_column("performance_takes", "deletion_status")

    if "performance_take_upload_authorizations" in existing_tables:
        op.drop_table("performance_take_upload_authorizations")
