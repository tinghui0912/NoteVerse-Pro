"""Simplify performance take recording timebase.

Revision ID: 0067_simplify_recording_timebase
Revises: 0066_promote_performance_take_tempo_plan
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0067_simplify_recording_timebase"
down_revision: str | None = "0066_promote_performance_take_tempo_plan"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLES = (
    "performance_takes",
    "performance_take_upload_authorizations",
)


def _migrate_postgresql(table_name: str) -> None:
    op.execute(
        sa.text(
            f"""
            DELETE FROM {table_name}
            WHERE recording_timebase IS NULL
              OR recording_timebase::jsonb -> 'nominalMediaDurationMs' IS NULL
              OR recording_timebase::jsonb -> 'activeSegments' IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET recording_timebase = jsonb_build_object(
                'nominalMediaDurationMs', recording_timebase::jsonb -> 'nominalMediaDurationMs',
                'activeSegments', recording_timebase::jsonb -> 'activeSegments'
            )::text
            """
        )
    )


def _migrate_sqlite(table_name: str) -> None:
    op.execute(
        sa.text(
            f"""
            DELETE FROM {table_name}
            WHERE recording_timebase IS NULL
              OR json_type(recording_timebase, '$.nominalMediaDurationMs') IS NULL
              OR json_type(recording_timebase, '$.activeSegments') IS NULL
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET recording_timebase = json_object(
                'nominalMediaDurationMs', json_extract(recording_timebase, '$.nominalMediaDurationMs'),
                'activeSegments', json(json_extract(recording_timebase, '$.activeSegments'))
            )
            """
        )
    )


def _migrate_other(table_name: str) -> None:
    op.execute(sa.text(f"DELETE FROM {table_name}"))


def upgrade() -> None:
    bind = op.get_bind()
    for table_name in TABLES:
        if bind.dialect.name == "postgresql":
            _migrate_postgresql(table_name)
        elif bind.dialect.name == "sqlite":
            _migrate_sqlite(table_name)
        else:
            _migrate_other(table_name)


def downgrade() -> None:
    raise RuntimeError("0067_simplify_recording_timebase is destructive; restore from Git history.")
