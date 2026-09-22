"""Add check constraints for performance take status columns.

Revision ID: 0061_performance_take_status_checks
Revises: 0060_add_video_take_media_kind
Create Date: 2026-09-22 00:00:00.000000
"""

from __future__ import annotations

from typing import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0061_performance_take_status_checks"
down_revision: str | Sequence[str] | None = "0060_add_video_take_media_kind"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


CONSTRAINTS = (
    (
        "performance_takes",
        "deletion_status",
        "ck_performance_takes_deletion_status",
        ("ACTIVE", "DELETING"),
    ),
    (
        "performance_take_delete_outbox",
        "status",
        "ck_performance_take_delete_outbox_status",
        ("PENDING", "DISPATCHED", "PROCESSING", "COMPLETED", "FAILED"),
    ),
    (
        "performance_take_upload_authorizations",
        "status",
        "ck_performance_take_upload_auth_status",
        ("AUTHORIZED", "FINALIZING", "ARCHIVED", "CANCELLED", "EXPIRED"),
    ),
)


def _constraint_exists(table_name: str, constraint_name: str) -> bool:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            """
            SELECT 1
            FROM pg_constraint c
            JOIN pg_class t ON t.oid = c.conrelid
            WHERE t.relname = :table_name
              AND c.conname = :constraint_name
            """
        ),
        {"table_name": table_name, "constraint_name": constraint_name},
    )
    return result.first() is not None


def _assert_no_invalid_values(table_name: str, column_name: str, allowed: tuple[str, ...]) -> None:
    bind = op.get_bind()
    result = bind.execute(
        sa.text(
            f"""
            SELECT {column_name}, count(*) AS count
            FROM {table_name}
            WHERE {column_name} IS NULL OR {column_name} NOT IN :allowed
            GROUP BY {column_name}
            """
        ).bindparams(sa.bindparam("allowed", expanding=True)),
        {"allowed": allowed},
    )
    invalid = result.fetchall()
    if invalid:
        details = ", ".join(f"{row[0]!r}={row[1]}" for row in invalid)
        raise RuntimeError(
            f"Cannot add {table_name}.{column_name} status check; invalid values exist: {details}"
        )


def upgrade() -> None:
    for table_name, column_name, constraint_name, allowed in CONSTRAINTS:
        if _constraint_exists(table_name, constraint_name):
            continue
        _assert_no_invalid_values(table_name, column_name, allowed)
        allowed_sql = ", ".join(f"'{value}'" for value in allowed)
        op.create_check_constraint(
            constraint_name,
            table_name,
            f"{column_name} IN ({allowed_sql})",
        )


def downgrade() -> None:
    for table_name, _column_name, constraint_name, _allowed in reversed(CONSTRAINTS):
        if _constraint_exists(table_name, constraint_name):
            op.drop_constraint(constraint_name, table_name=table_name, type_="check")
