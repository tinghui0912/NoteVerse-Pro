"""Durable retirement of committed physical objects through real semantic references."""

from uuid import uuid4
from alembic import op
import sqlalchemy as sa

revision = "0057_stored_object_retirement"
down_revision = "0056_stored_object_authority"
branch_labels = None
depends_on = None


def upgrade():
    bind = op.get_bind()
    for table in ("performance_take_delete_outbox", "practice_bundle_delete_outbox"):
        if bind.execute(
            sa.text(f"SELECT count(*) FROM {table} WHERE status != 'COMPLETED'")
        ).scalar_one():
            raise RuntimeError(
                "StoredObject retirement migration: in-flight deletion; recreate the pre-release environment"
            )
    for table in ("performance_takes", "practice_bundles"):
        field = "deletion_status" if table == "performance_takes" else "status"
        if bind.execute(
            sa.text(f"SELECT count(*) FROM {table} WHERE {field} = 'DELETING'")
        ).scalar_one():
            raise RuntimeError(
                "StoredObject retirement migration: DELETING owner; recreate the pre-release environment"
            )
    pk = sa.BigInteger().with_variant(sa.Integer(), "sqlite")
    op.create_table(
        "stored_object_retirements",
        sa.Column("id", pk, primary_key=True, autoincrement=True),
        sa.Column("retirement_uuid", sa.String(36), nullable=False, unique=True),
        sa.Column(
            "stored_object_id",
            pk,
            sa.ForeignKey("stored_objects.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("object_key", sa.String(768), nullable=False),
        sa.Column("byte_size", sa.BigInteger(), nullable=False),
        sa.Column("sha256", sa.String(64), nullable=False),
        sa.Column("content_type", sa.String(255), nullable=False),
        sa.Column("status", sa.String(24), nullable=False),
        sa.Column("attempt_count", sa.Integer(), nullable=False),
        sa.Column("attempt_token", sa.String(36)),
        sa.Column("next_attempt_at", sa.DateTime(), nullable=False),
        sa.Column("dispatched_at", sa.DateTime()),
        sa.Column("started_at", sa.DateTime()),
        sa.Column("completed_at", sa.DateTime()),
        sa.Column("last_error", sa.Text()),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.UniqueConstraint("stored_object_id", name="uq_object_retirement_object"),
        sa.CheckConstraint(
            "status IN ('PENDING','DISPATCHED','PROCESSING','FAILED','COMPLETED','CANCELLED')",
            name="ck_object_retirement_status",
        ),
        sa.CheckConstraint("attempt_count >= 0", name="ck_object_retirement_attempts"),
    )
    op.create_index(
        "ix_object_retirement_due", "stored_object_retirements", ["status", "next_attempt_at"]
    )
    op.drop_table("performance_take_delete_outbox")
    op.drop_table("practice_bundle_delete_outbox")
    with op.batch_alter_table("performance_takes") as batch:
        batch.drop_constraint("ck_performance_takes_deletion_status", type_="check")
        batch.drop_column("deletion_status")
    with op.batch_alter_table("practice_bundles") as batch:
        batch.drop_constraint("ck_practice_bundles_status", type_="check")
        batch.drop_constraint("ck_practice_bundles_creation_lease", type_="check")
        batch.create_check_constraint(
            "ck_practice_bundles_status", "status IN ('CREATING', 'READY')"
        )
        batch.create_check_constraint(
            "ck_practice_bundles_creation_lease",
            "(status = 'CREATING' AND creation_expires_at IS NOT NULL) OR (status = 'READY' AND creation_expires_at IS NULL)",
        )
    # Existing unowned committed objects also receive durable work. Discovery uses real FKs.
    metadata = sa.MetaData()
    metadata.reflect(bind=bind)
    objects = metadata.tables["stored_objects"]
    operations = metadata.tables["stored_object_retirements"]
    references = [
        fk.parent
        for table in metadata.tables.values()
        if table.name != operations.name
        for fk in table.foreign_keys
        if fk.column.table.name == objects.name
    ]
    unowned = sa.select(objects).where(
        ~sa.or_(
            *(sa.select(column).where(column == objects.c.id).exists() for column in references)
        )
    )
    for row in bind.execute(unowned).mappings():
        bind.execute(
            operations.insert().values(
                retirement_uuid=str(uuid4()),
                stored_object_id=row["id"],
                object_key=row["object_key"],
                byte_size=row["byte_size"],
                sha256=row["sha256"],
                content_type=row["content_type"],
                status="PENDING",
                attempt_count=0,
                next_attempt_at=sa.func.now(),
                created_at=sa.func.now(),
                updated_at=sa.func.now(),
            )
        )


def downgrade():
    raise RuntimeError(
        "StoredObject retirement downgrade requires pre-release environment recreation"
    )
