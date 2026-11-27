"""Bounded credential erasure and credential-free mail admission predicates."""

from alembic import op
from app.platform.db.authorization import install_security_functions

revision = "0002_database_authorization"
down_revision = "0001_initial_schema"
branch_labels = None
depends_on = None


def upgrade() -> None:
    install_security_functions(op.get_bind())


def downgrade() -> None:
    for signature in (
        "nv_erase_closed_identity(bigint)",
        "nv_erase_closed_authentication_history(bigint,integer)",
        "nv_mail_has_payload(text)",
        "nv_authentication_mail_source_active(text,bigint)",
    ):
        op.execute("DROP FUNCTION " + signature)
