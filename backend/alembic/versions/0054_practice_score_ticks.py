"""Store Practice score coordinates as exact source-local ticks."""

from alembic import op
import sqlalchemy as sa

revision = "0054_practice_score_ticks"
down_revision = "0053_practice_source_takes"
branch_labels = None
depends_on = None

TABLES = ("performance_takes", "performance_take_upload_reservations")


def _require_empty_coordinate_records() -> None:
    # Source-local timebases cannot be inferred from persisted float coordinates.
    connection = op.get_bind()
    for table in TABLES:
        if connection.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first():
            raise RuntimeError(
                "Practice tick contract requires empty development Take/reservation records."
            )


def upgrade() -> None:
    _require_empty_coordinate_records()
    for table in TABLES:
        for field in ("scope_start", "scope_terminal"):
            op.add_column(table, sa.Column(f"{field}_tick", sa.BigInteger(), nullable=False))
            op.drop_column(table, f"{field}_beat")


def downgrade() -> None:
    _require_empty_coordinate_records()
    for table in TABLES:
        for field in ("scope_start", "scope_terminal"):
            op.add_column(table, sa.Column(f"{field}_beat", sa.Float(), nullable=False))
            op.drop_column(table, f"{field}_tick")
