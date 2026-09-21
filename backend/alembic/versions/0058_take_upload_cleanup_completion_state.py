"""Track final cleanup completion for take upload authorizations.

Revision ID: 0058_take_upload_cleanup_completion
Revises: 0057_take_upload_finalizing_cleanup
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa

revision: str = "0058_take_upload_cleanup_completion"
down_revision: str | None = "0057_take_upload_finalizing_cleanup"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


TABLE = "performance_take_upload_authorizations"


def upgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if TABLE not in existing_tables:
        raise RuntimeError(
            f"{TABLE} is required before applying {revision}; "
            "the expected take upload authorization schema is missing."
        )

    columns = {column["name"] for column in inspector.get_columns(TABLE)}
    if "final_cleanup_completed_at" not in columns:
        op.add_column(TABLE, sa.Column("final_cleanup_completed_at", sa.DateTime(), nullable=True))

    # Historical rows created before 0057 did not persist the latest PUT URL
    # expiry. Existing configuration uses a 15 minute presign TTL, but the
    # value is environment-driven and older deployments did not store it per
    # authorization. Do not infer that these URLs are already expired when this
    # migration runs; give terminal rows a migration-time compatibility grace
    # before staging cleanup can be finalized.
    bind.execute(
        sa.text(
            """
            UPDATE performance_take_upload_authorizations
               SET last_put_url_expires_at = COALESCE(
                       last_put_url_expires_at,
                       GREATEST(
                           expires_at + INTERVAL '1 hour',
                           CURRENT_TIMESTAMP + INTERVAL '7 days'
                       )
                   ),
                   staging_cleanup_after = COALESCE(
                       staging_cleanup_after,
                       GREATEST(
                           expires_at + INTERVAL '1 hour',
                           CURRENT_TIMESTAMP + INTERVAL '7 days'
                       )
                   )
             WHERE status IN ('CANCELLED', 'EXPIRED', 'ARCHIVED')
            """
        )
    )

    indexes = {index["name"] for index in inspector.get_indexes(TABLE)}
    if "ix_take_upload_auth_final_cleanup" not in indexes:
        op.create_index(
            "ix_take_upload_auth_final_cleanup",
            TABLE,
            ["final_cleanup_completed_at", "status"],
        )


def downgrade() -> None:
    bind = op.get_bind()
    inspector = sa.inspect(bind)
    existing_tables = set(inspector.get_table_names())
    if TABLE not in existing_tables:
        return

    indexes = {index["name"] for index in inspector.get_indexes(TABLE)}
    if "ix_take_upload_auth_final_cleanup" in indexes:
        op.drop_index("ix_take_upload_auth_final_cleanup", table_name=TABLE)

    columns = {column["name"] for column in inspector.get_columns(TABLE)}
    if "final_cleanup_completed_at" in columns:
        op.drop_column(TABLE, "final_cleanup_completed_at")
