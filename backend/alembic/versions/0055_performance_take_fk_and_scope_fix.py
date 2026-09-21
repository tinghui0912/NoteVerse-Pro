"""Harden performance_takes foreign keys and add scope_type.

Revision ID: 0055_performance_take_fk_and_scope_fix
Revises: 0054_performance_take_score_independence
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0055_performance_take_fk_and_scope_fix"
down_revision: str | None = "0054_performance_take_score_independence"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [col["name"] for col in inspector.get_columns("performance_takes")]

    if bind.dialect.name == "postgresql":
        if "score_title" not in columns:
            op.add_column(
                "performance_takes",
                sa.Column("score_title", sa.String(length=255), nullable=True),
            )
        if "scope_type" not in columns:
            op.add_column(
                "performance_takes",
                sa.Column("scope_type", sa.String(length=16), nullable=False, server_default="FULL"),
            )

        # Backfill score_title for existing takes that have a score_id
        bind.execute(
            sa.text(
                "UPDATE performance_takes "
                "SET score_title = scores.title "
                "FROM scores "
                "WHERE performance_takes.score_id = scores.id "
                "AND performance_takes.score_title IS NULL"
            )
        )

        op.alter_column("performance_takes", "score_id", nullable=True)

        fks = inspector.get_foreign_keys("performance_takes")
        for fk in fks:
            fk_name = fk.get("name")
            constrained = fk.get("constrained_columns", [])
            referred = fk.get("referred_table")
            if referred == "scores" and "score_id" in constrained:
                if fk_name:
                    op.drop_constraint(fk_name, "performance_takes", type_="foreignkey")
            elif referred == "score_revisions" and "revision_id" in constrained:
                if fk_name:
                    op.drop_constraint(fk_name, "performance_takes", type_="foreignkey")

        op.create_foreign_key(
            "fk_performance_takes_score_id_scores",
            "performance_takes",
            "scores",
            ["score_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_foreign_key(
            "fk_performance_takes_revision_id_score_revisions",
            "performance_takes",
            "score_revisions",
            ["revision_id"],
            ["id"],
            ondelete="SET NULL",
        )

    elif bind.dialect.name == "sqlite":
        # SQLite recreate table to ensure foreign keys have ON DELETE SET NULL
        table_args = (
            sa.ForeignKeyConstraint(["user_id"], ["users.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["score_id"], ["scores.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["revision_id"], ["score_revisions.id"], ondelete="SET NULL"),
            sa.UniqueConstraint("user_id", "client_request_id", name="uq_performance_takes_user_client_request_id"),
        )
        with op.batch_alter_table("performance_takes", recreate="always", table_args=table_args) as batch_op:
            batch_op.alter_column("score_id", existing_type=sa.BigInteger(), nullable=True)
            if "score_title" not in columns:
                batch_op.add_column(sa.Column("score_title", sa.String(length=255), nullable=True))
            if "scope_type" not in columns:
                batch_op.add_column(sa.Column("scope_type", sa.String(length=16), nullable=False, server_default="FULL"))

        # Backfill score_title in SQLite
        bind.execute(
            sa.text(
                "UPDATE performance_takes "
                "SET score_title = (SELECT title FROM scores WHERE scores.id = performance_takes.score_id) "
                "WHERE performance_takes.score_id IS NOT NULL AND performance_takes.score_title IS NULL"
            )
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [col["name"] for col in inspector.get_columns("performance_takes")]

    if bind.dialect.name == "postgresql":
        if "scope_type" in columns:
            op.drop_column("performance_takes", "scope_type")
    elif bind.dialect.name == "sqlite":
        with op.batch_alter_table("performance_takes", recreate="always") as batch_op:
            if "scope_type" in columns:
                batch_op.drop_column("scope_type")
