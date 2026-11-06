"""Persist complete source-local Practice score coordinate snapshots."""

from alembic import op
import sqlalchemy as sa

revision = "0055_take_score_timebase"
down_revision = "0054_practice_score_ticks"
branch_labels = None
depends_on = None

TABLE_CONSTRAINTS = (("performance_take_manifests", "ck_take_manifest_score_coordinates"),)
SCORE_COORDINATES = (
    "ticks_per_quarter > 0 AND ticks_per_quarter <= 9007199254740991 "
    "AND scope_start_tick >= 0 AND scope_start_tick <= 9007199254740991 "
    "AND scope_terminal_tick > 0 AND scope_terminal_tick <= 9007199254740991 "
    "AND scope_terminal_tick >= scope_start_tick"
)


def _require_empty_records() -> None:
    connection = op.get_bind()
    # A source-local grid is never inferred from stored ticks.
    for table, _ in TABLE_CONSTRAINTS:
        if connection.execute(sa.text(f"SELECT 1 FROM {table} LIMIT 1")).first():
            raise RuntimeError(
                "Score timebase contract requires empty development Manifest records."
            )


def upgrade() -> None:
    _require_empty_records()
    for table, constraint in TABLE_CONSTRAINTS:
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("ticks_per_quarter", sa.BigInteger(), nullable=False))
            batch.create_check_constraint(constraint, SCORE_COORDINATES)


def downgrade() -> None:
    _require_empty_records()
    for table, constraint in TABLE_CONSTRAINTS:
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(constraint, type_="check")
            batch.drop_column("ticks_per_quarter")
