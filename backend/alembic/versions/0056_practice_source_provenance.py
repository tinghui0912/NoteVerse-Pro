"""Source-owned upload reservation provenance."""

from alembic import op
import sqlalchemy as sa

revision = "0056_practice_source_provenance"
down_revision = "0055_durable_practice_source"
branch_labels = None
depends_on = None


def upgrade() -> None:
    table = "performance_take_upload_reservations"
    op.drop_constraint("fk_take_upload_reservation_revision", table, type_="foreignkey")
    for name in ["score_uuid", "revision_uuid", "artifact_id", "revision_id"]:
        op.drop_column(table, name)
    op.alter_column(table, "score_id", new_column_name="linked_score_id")
    op.create_index(
        "ix_performance_take_upload_reservations_linked_score_id", table, ["linked_score_id"]
    )
    op.execute(
        sa.text(
            f"ALTER TABLE {table} RENAME CONSTRAINT fk_take_upload_reservation_score TO fk_take_upload_reservation_linked_score"
        )
    )


def downgrade() -> None:
    raise RuntimeError(
        "Source-owned reservation provenance requires restoring the pre-upgrade database backup"
    )
