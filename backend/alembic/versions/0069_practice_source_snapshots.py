"""Add immutable practice source snapshots for performance takes.

Revision ID: 0069_practice_source_snapshots
Revises: 0068_add_performance_take_evaluation
Create Date: 2026-09-30
"""

from __future__ import annotations

from alembic import op
import sqlalchemy as sa


revision = "0069_practice_source_snapshots"
down_revision = "0068_add_performance_take_evaluation"
branch_labels = None
depends_on = None


def _has_table(table_name: str) -> bool:
    return table_name in sa.inspect(op.get_bind()).get_table_names()


def _columns(table_name: str) -> set[str]:
    return {column["name"] for column in sa.inspect(op.get_bind()).get_columns(table_name)}


def _drop_fk_to(table_name: str, referred_table: str) -> None:
    inspector = sa.inspect(op.get_bind())
    for fk in inspector.get_foreign_keys(table_name):
        if fk.get("referred_table") == referred_table and fk.get("name"):
            op.drop_constraint(fk["name"], table_name, type_="foreignkey")


def upgrade() -> None:
    if not _has_table("practice_source_snapshots"):
        op.create_table(
            "practice_source_snapshots",
            sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), primary_key=True, autoincrement=True),
            sa.Column("snapshot_uuid", sa.String(length=36), nullable=False),
            sa.Column("source_fingerprint", sa.String(length=128), nullable=False),
            sa.Column("source_score_uuid", sa.String(length=36), nullable=False),
            sa.Column("source_revision_uuid", sa.String(length=36), nullable=False),
            sa.Column("artifact_id", sa.String(length=128), nullable=False),
            sa.Column("artifact_schema_version", sa.Integer(), nullable=False),
            sa.Column("prepared_musicxml_object_key", sa.String(length=768), nullable=False),
            sa.Column("prepared_musicxml_sha256", sa.String(length=64), nullable=False),
            sa.Column("prepared_musicxml_byte_size", sa.BigInteger(), nullable=False),
            sa.Column("artifact_object_key", sa.String(length=768), nullable=False),
            sa.Column("artifact_sha256", sa.String(length=64), nullable=False),
            sa.Column("artifact_byte_size", sa.BigInteger(), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=False, server_default=sa.func.now()),
            sa.UniqueConstraint("snapshot_uuid", name="uq_practice_source_snapshots_uuid"),
            sa.UniqueConstraint("source_fingerprint", name="uq_practice_source_snapshots_fingerprint"),
            sa.UniqueConstraint("prepared_musicxml_object_key", name="uq_practice_source_snapshots_musicxml_key"),
            sa.UniqueConstraint("artifact_object_key", name="uq_practice_source_snapshots_artifact_key"),
        )
        op.create_index(
            "ix_practice_source_snapshots_source_score_revision",
            "practice_source_snapshots",
            ["source_score_uuid", "source_revision_uuid"],
        )

    if _has_table("performance_take_delete_outbox"):
        op.execute(sa.text("DELETE FROM performance_take_delete_outbox"))
    if _has_table("performance_take_upload_authorizations"):
        op.execute(sa.text("DELETE FROM performance_take_upload_authorizations"))
    if _has_table("performance_takes"):
        op.execute(sa.text("DELETE FROM performance_takes"))

    if _has_table("performance_takes"):
        columns = _columns("performance_takes")
        if "source_snapshot_id" not in columns:
            op.add_column(
                "performance_takes",
                sa.Column("source_snapshot_id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), nullable=True),
            )
            op.create_index(
                "ix_performance_takes_source_snapshot_id",
                "performance_takes",
                ["source_snapshot_id"],
            )
        if "evaluation" in columns:
            op.drop_column("performance_takes", "evaluation")

        _drop_fk_to("performance_takes", "scores")
        _drop_fk_to("performance_takes", "score_revisions")
        _drop_fk_to("performance_takes", "practice_source_snapshots")
        with op.batch_alter_table("performance_takes") as batch_op:
            batch_op.alter_column("score_id", existing_type=sa.BigInteger(), nullable=True)
            batch_op.alter_column("revision_id", existing_type=sa.BigInteger(), nullable=True)
            batch_op.alter_column("source_snapshot_id", existing_type=sa.BigInteger(), nullable=False)
            batch_op.create_foreign_key(
                "fk_performance_takes_score_id_scores",
                "scores",
                ["score_id"],
                ["id"],
                ondelete="SET NULL",
            )
            batch_op.create_foreign_key(
                "fk_performance_takes_revision_id_score_revisions",
                "score_revisions",
                ["revision_id"],
                ["id"],
                ondelete="SET NULL",
            )
            batch_op.create_foreign_key(
                "fk_performance_takes_source_snapshot_id_snapshots",
                "practice_source_snapshots",
                ["source_snapshot_id"],
                ["id"],
                ondelete="RESTRICT",
            )

    if _has_table("performance_take_upload_authorizations"):
        columns = _columns("performance_take_upload_authorizations")
        if "evaluation" in columns:
            op.drop_column("performance_take_upload_authorizations", "evaluation")
        _drop_fk_to("performance_take_upload_authorizations", "scores")
        _drop_fk_to("performance_take_upload_authorizations", "score_revisions")
        with op.batch_alter_table("performance_take_upload_authorizations") as batch_op:
            batch_op.alter_column("score_id", existing_type=sa.BigInteger(), nullable=True)
            batch_op.alter_column("revision_id", existing_type=sa.BigInteger(), nullable=True)
            batch_op.create_foreign_key(
                "fk_take_upload_auth_score_id_scores",
                "scores",
                ["score_id"],
                ["id"],
                ondelete="SET NULL",
            )
            batch_op.create_foreign_key(
                "fk_take_upload_auth_revision_id_score_revisions",
                "score_revisions",
                ["revision_id"],
                ["id"],
                ondelete="SET NULL",
            )


def downgrade() -> None:
    raise RuntimeError("0069_practice_source_snapshots is destructive and cannot be downgraded")
