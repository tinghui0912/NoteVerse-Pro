"""Promote performance take recording timebase to a typed field.

Revision ID: 0065_promote_performance_take_recording_timebase
Revises: 0064_promote_performance_take_scope_identity
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0065_promote_performance_take_recording_timebase"
down_revision: str | None = "0064_promote_performance_take_scope_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLES = (
    "performance_takes",
    "performance_take_upload_authorizations",
)


def _add_recording_timebase_column(table_name: str) -> None:
    op.add_column(table_name, sa.Column("recording_timebase", sa.Text(), nullable=True))


def _migrate_postgresql(table_name: str) -> None:
    op.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET recording_timebase = (sync_metadata::jsonb -> 'recordingTimebase')::text
            WHERE sync_metadata::jsonb ? 'recordingTimebase'
            """
        )
    )
    op.execute(sa.text(f"DELETE FROM {table_name} WHERE recording_timebase IS NULL"))


def _migrate_sqlite(table_name: str) -> None:
    op.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET recording_timebase = json_extract(sync_metadata, '$.recordingTimebase')
            WHERE json_type(sync_metadata, '$.recordingTimebase') = 'object'
            """
        )
    )
    op.execute(sa.text(f"DELETE FROM {table_name} WHERE recording_timebase IS NULL"))


def _migrate_other(table_name: str) -> None:
    op.execute(sa.text(f"DELETE FROM {table_name}"))


def _finalize_columns(table_name: str) -> None:
    with op.batch_alter_table(table_name) as batch_op:
        batch_op.alter_column("recording_timebase", existing_type=sa.Text(), nullable=False)
        batch_op.drop_column("sync_metadata")


def upgrade() -> None:
    bind = op.get_bind()
    for table_name in TABLES:
        _add_recording_timebase_column(table_name)
        if bind.dialect.name == "postgresql":
            _migrate_postgresql(table_name)
        elif bind.dialect.name == "sqlite":
            _migrate_sqlite(table_name)
        else:
            _migrate_other(table_name)
        _finalize_columns(table_name)


def downgrade() -> None:
    raise RuntimeError(
        "0065_promote_performance_take_recording_timebase is destructive; restore from Git history."
    )
