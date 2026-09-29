"""Promote performance take scope identity to typed columns.

Revision ID: 0064_promote_performance_take_scope_identity
Revises: 0063_require_performance_take_source_identity
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0064_promote_performance_take_scope_identity"
down_revision: str | None = "0063_require_performance_take_source_identity"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLES = (
    "performance_takes",
    "performance_take_upload_authorizations",
)


def _add_columns(table_name: str) -> None:
    op.add_column(
        table_name,
        sa.Column("scope_start_group_id", sa.String(length=128), nullable=True),
    )
    op.add_column(
        table_name,
        sa.Column("scope_end_group_id", sa.String(length=128), nullable=True),
    )


def _migrate_postgresql(table_name: str) -> None:
    op.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET scope_start_group_id = sync_metadata::jsonb -> 'scopeIdentity' ->> 'startGroupId',
                scope_end_group_id = sync_metadata::jsonb -> 'scopeIdentity' ->> 'endGroupId'
            WHERE scope_type = 'RANGE'
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            DELETE FROM {table_name}
            WHERE scope_type = 'RANGE'
              AND (
                scope_start_group_id IS NULL
                OR scope_start_group_id = ''
                OR scope_end_group_id IS NULL
                OR scope_end_group_id = ''
              )
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET sync_metadata = jsonb_build_object(
                'recordingTimebase',
                sync_metadata::jsonb -> 'recordingTimebase'
            )::text
            """
        )
    )


def _migrate_sqlite(table_name: str) -> None:
    op.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET scope_start_group_id = json_extract(sync_metadata, '$.scopeIdentity.startGroupId'),
                scope_end_group_id = json_extract(sync_metadata, '$.scopeIdentity.endGroupId')
            WHERE scope_type = 'RANGE'
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            DELETE FROM {table_name}
            WHERE scope_type = 'RANGE'
              AND (
                scope_start_group_id IS NULL
                OR scope_start_group_id = ''
                OR scope_end_group_id IS NULL
                OR scope_end_group_id = ''
              )
            """
        )
    )
    op.execute(
        sa.text(
            f"""
            UPDATE {table_name}
            SET sync_metadata = json_object(
                'recordingTimebase',
                json_extract(sync_metadata, '$.recordingTimebase')
            )
            """
        )
    )


def _migrate_other(table_name: str) -> None:
    op.execute(
        sa.text(
            f"""
            DELETE FROM {table_name}
            WHERE scope_type = 'RANGE'
            """
        )
    )


def upgrade() -> None:
    bind = op.get_bind()
    for table_name in TABLES:
        _add_columns(table_name)
        if bind.dialect.name == "postgresql":
            _migrate_postgresql(table_name)
        elif bind.dialect.name == "sqlite":
            _migrate_sqlite(table_name)
        else:
            _migrate_other(table_name)


def downgrade() -> None:
    raise RuntimeError(
        "0064_promote_performance_take_scope_identity is destructive; restore from Git history."
    )
