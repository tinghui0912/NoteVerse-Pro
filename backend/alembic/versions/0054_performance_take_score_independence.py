"""Make performance_takes.score_id nullable with SET NULL and add score_title.

Revision ID: 0054_performance_take_score_independence
Revises: 0053_performance_takes
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa


revision: str = "0054_performance_take_score_independence"
down_revision: str | None = "0053_performance_takes"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [col["name"] for col in inspector.get_columns("performance_takes")]

    if "score_title" not in columns:
        op.add_column(
            "performance_takes",
            sa.Column("score_title", sa.String(length=255), nullable=True),
        )

    # For postgresql, alter score_id to nullable if not already
    if bind.dialect.name == "postgresql":
        op.alter_column("performance_takes", "score_id", nullable=True)
        # Drop existing FK constraint if present and recreate with SET NULL
        fks = inspector.get_foreign_keys("performance_takes")
        for fk in fks:
            if fk.get("referred_table") == "scores" and "score_id" in fk.get("constrained_columns", []):
                fk_name = fk.get("name")
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
    elif bind.dialect.name == "sqlite":
        # SQLite batch mode if needed
        with op.batch_alter_table("performance_takes") as batch_op:
            batch_op.alter_column("score_id", nullable=True)


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    columns = [col["name"] for col in inspector.get_columns("performance_takes")]

    if "score_title" in columns:
        op.drop_column("performance_takes", "score_title")

    if bind.dialect.name == "postgresql":
        op.alter_column("performance_takes", "score_id", nullable=False)
