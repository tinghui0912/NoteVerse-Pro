"""Durable server write operations and honest Bundle creation leases."""

from alembic import op
import sqlalchemy as sa

revision = "0059_object_write_intents"
down_revision = "0058_stored_object_reference_indexes"
branch_labels = None
depends_on = None


def upgrade():
    if (
        op.get_bind()
        .execute(sa.text("SELECT count(*) FROM practice_bundles WHERE status = 'CREATING'"))
        .scalar_one()
    ):
        raise RuntimeError(
            "Object write migration: CREATING Bundle requires pre-release environment recreation"
        )
    op.create_table(
        "object_write_intents",
        sa.Column(
            "id",
            sa.BigInteger().with_variant(sa.Integer(), "sqlite"),
            primary_key=True,
            autoincrement=True,
        ),
        sa.Column("intent_uuid", sa.String(36), nullable=False, unique=True),
        sa.Column("object_key", sa.String(768), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("write_token", sa.String(36), nullable=False),
        sa.Column("write_expires_at", sa.DateTime(), nullable=False),
        sa.Column("written_at", sa.DateTime()),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("attempt_token", sa.String(36)),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False),
        sa.Column("dispatched_at", sa.DateTime()),
        sa.Column("started_at", sa.DateTime()),
        sa.Column("completed_at", sa.DateTime()),
        sa.Column("last_error", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("object_key", name="uq_object_write_intent_key"),
        sa.CheckConstraint(
            "status IN ('PREPARED','WRITTEN','ADOPTED','CLEANUP_PENDING','CLEANUP_DISPATCHED','CLEANUP_PROCESSING','CLEANUP_FAILED','CLEANED')",
            name="ck_object_write_intent_status",
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_object_write_intent_attempts"),
    )
    op.create_index(
        "ix_object_write_intent_due", "object_write_intents", ["status", "next_attempt_at"]
    )
    with op.batch_alter_table("practice_bundles") as batch:
        batch.drop_constraint("ck_practice_bundles_creation_lease", type_="check")
        batch.alter_column(
            "prepared_musicxml_object_id", existing_type=sa.BigInteger(), nullable=True
        )
        batch.alter_column("artifact_object_id", existing_type=sa.BigInteger(), nullable=True)
        batch.create_check_constraint(
            "ck_practice_bundles_creation_lease",
            "(status = 'CREATING' AND creation_expires_at IS NOT NULL AND prepared_musicxml_object_id IS NULL AND artifact_object_id IS NULL) OR (status = 'READY' AND creation_expires_at IS NULL AND prepared_musicxml_object_id IS NOT NULL AND artifact_object_id IS NOT NULL)",
        )


def downgrade():
    bind = op.get_bind()
    if (
        bind.execute(sa.text("SELECT count(*) FROM object_write_intents")).scalar_one()
        or bind.execute(
            sa.text("SELECT count(*) FROM practice_bundles WHERE status='CREATING'")
        ).scalar_one()
    ):
        raise RuntimeError("Object write downgrade requires pre-release environment recreation")
    with op.batch_alter_table("practice_bundles") as batch:
        batch.drop_constraint("ck_practice_bundles_creation_lease", type_="check")
        batch.alter_column(
            "prepared_musicxml_object_id", existing_type=sa.BigInteger(), nullable=False
        )
        batch.alter_column("artifact_object_id", existing_type=sa.BigInteger(), nullable=False)
        batch.create_check_constraint(
            "ck_practice_bundles_creation_lease",
            "(status = 'CREATING' AND creation_expires_at IS NOT NULL) OR (status = 'READY' AND creation_expires_at IS NULL)",
        )
    op.drop_table("object_write_intents")
