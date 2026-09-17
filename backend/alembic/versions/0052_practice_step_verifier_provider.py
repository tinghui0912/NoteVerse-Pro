"""Add STEP microphone verifier provider decision.

Revision ID: 0052_practice_step_verifier_provider
Revises: 0051_practice_attempt_skip
"""

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op


revision: str = "0052_practice_step_verifier_provider"
down_revision: str | None = "0051_practice_attempt_skip"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


_provider_enum = sa.Enum(
    "SERVER",
    "BROWSER_LOCAL",
    name="practicestepmicrophoneverificationprovider",
)


def upgrade() -> None:
    bind = op.get_bind()
    _provider_enum.create(bind, checkfirst=True)
    columns = {column["name"] for column in sa.inspect(bind).get_columns("practice_sessions")}
    if "step_microphone_verification_provider" not in columns:
        op.add_column(
            "practice_sessions",
            sa.Column("step_microphone_verification_provider", _provider_enum, nullable=True),
        )


def downgrade() -> None:
    bind = op.get_bind()
    columns = {column["name"] for column in sa.inspect(bind).get_columns("practice_sessions")}
    if "step_microphone_verification_provider" in columns:
        op.drop_column("practice_sessions", "step_microphone_verification_provider")
    _provider_enum.drop(bind, checkfirst=True)
