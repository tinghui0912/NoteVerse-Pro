"""Require durable source identity for performance takes.

Revision ID: 0063_require_performance_take_source_identity
Revises: 0062_drop_legacy_practice_runtime
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0063_require_performance_take_source_identity"
down_revision: str | None = "0062_drop_legacy_practice_runtime"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def _drop_fk_to(bind, table_name: str, referred_table: str, constrained_column: str) -> None:
    inspector = sa.inspect(bind)
    for fk in inspector.get_foreign_keys(table_name):
        if (
            fk.get("referred_table") == referred_table
            and constrained_column in fk.get("constrained_columns", [])
            and fk.get("name")
        ):
            op.drop_constraint(fk["name"], table_name, type_="foreignkey")


def _delete_incomplete_rows(table_name: str) -> None:
    op.execute(
        sa.text(
            f"""
            DELETE FROM {table_name}
            WHERE score_id IS NULL
               OR revision_id IS NULL
               OR artifact_id IS NULL
               OR resolved_tempo_plan IS NULL
               OR sync_metadata IS NULL
            """
        )
    )


def _harden_table_postgresql(table_name: str) -> None:
    bind = op.get_bind()
    _delete_incomplete_rows(table_name)
    _drop_fk_to(bind, table_name, "scores", "score_id")
    _drop_fk_to(bind, table_name, "score_revisions", "revision_id")
    op.alter_column(table_name, "score_id", nullable=False)
    op.alter_column(table_name, "revision_id", nullable=False)
    op.alter_column(table_name, "artifact_id", nullable=False)
    op.alter_column(table_name, "resolved_tempo_plan", nullable=False)
    op.alter_column(table_name, "sync_metadata", nullable=False)
    op.create_foreign_key(
        f"fk_{table_name}_score_id_scores",
        table_name,
        "scores",
        ["score_id"],
        ["id"],
        ondelete="RESTRICT",
    )
    op.create_foreign_key(
        f"fk_{table_name}_revision_id_score_revisions",
        table_name,
        "score_revisions",
        ["revision_id"],
        ["id"],
        ondelete="RESTRICT",
    )


def _harden_table_sqlite(table_name: str) -> None:
    _delete_incomplete_rows(table_name)
    with op.batch_alter_table(table_name, recreate="always") as batch_op:
        batch_op.alter_column("score_id", nullable=False)
        batch_op.alter_column("revision_id", nullable=False)
        batch_op.alter_column("artifact_id", nullable=False)
        batch_op.alter_column("resolved_tempo_plan", nullable=False)
        batch_op.alter_column("sync_metadata", nullable=False)


def upgrade() -> None:
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        _harden_table_postgresql("performance_takes")
        _harden_table_postgresql("performance_take_upload_authorizations")
    elif bind.dialect.name == "sqlite":
        _harden_table_sqlite("performance_takes")
        _harden_table_sqlite("performance_take_upload_authorizations")
    else:
        _delete_incomplete_rows("performance_takes")
        _delete_incomplete_rows("performance_take_upload_authorizations")
        for table_name in (
            "performance_takes",
            "performance_take_upload_authorizations",
        ):
            op.alter_column(table_name, "score_id", nullable=False)
            op.alter_column(table_name, "revision_id", nullable=False)
            op.alter_column(table_name, "artifact_id", nullable=False)
            op.alter_column(table_name, "resolved_tempo_plan", nullable=False)
            op.alter_column(table_name, "sync_metadata", nullable=False)


def downgrade() -> None:
    raise RuntimeError(
        "0063_require_performance_take_source_identity is destructive; restore from Git history."
    )
