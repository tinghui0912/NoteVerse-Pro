"""Create the isolated control-plane operator identity domain.

Revision ID: 0035_control_plane_identity
Revises: 0034_ops_audit_client_address
Create Date: 2026-08-02 00:00:00.000000
"""

from collections.abc import Sequence

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision: str = "0035_control_plane_identity"
down_revision: str | None = "0034_ops_audit_client_address"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


# Named PostgreSQL enums are created explicitly below.  Disabling automatic
# table-level creation keeps a retry of this migration from issuing the same
# CREATE TYPE twice.
operator_role = postgresql.ENUM("platform_operator", name="operatorrole", create_type=False)
operator_status = postgresql.ENUM("active", "disabled", name="operatorstatus", create_type=False)
operator_identity_provider = postgresql.ENUM(
    "local_password",
    "oidc",
    name="operatoridentityprovider",
    create_type=False,
)


def upgrade() -> None:
    bind = op.get_bind()
    operator_role.create(bind, checkfirst=True)
    operator_status.create(bind, checkfirst=True)
    operator_identity_provider.create(bind, checkfirst=True)

    op.create_table(
        "operators",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("operator_uuid", sa.String(length=36), nullable=False),
        sa.Column("display_name", sa.String(length=128), nullable=False),
        sa.Column("role", operator_role, nullable=False),
        sa.Column("status", operator_status, nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("operator_uuid"),
    )
    op.create_index("idx_operators_status", "operators", ["status"])

    op.create_table(
        "operator_identities",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("identity_uuid", sa.String(length=36), nullable=False),
        sa.Column("operator_id", sa.BigInteger(), nullable=False),
        sa.Column("provider", operator_identity_provider, nullable=False),
        sa.Column("issuer", sa.String(length=255), nullable=False),
        sa.Column("subject", sa.String(length=255), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_authenticated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["operator_id"], ["operators.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("identity_uuid"),
        sa.UniqueConstraint("provider", "issuer", "subject", name="uq_operator_identities_provider_issuer_subject"),
    )
    op.create_index("idx_operator_identities_operator", "operator_identities", ["operator_id"])

    op.create_table(
        "operator_password_credentials",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("identity_id", sa.BigInteger(), nullable=False),
        sa.Column("password_hash", sa.String(length=255), nullable=False),
        sa.Column("password_changed_at", sa.DateTime(), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("updated_at", sa.DateTime(), nullable=False),
        sa.ForeignKeyConstraint(["identity_id"], ["operator_identities.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("identity_id"),
    )

    op.create_table(
        "operator_sessions",
        sa.Column("id", sa.BigInteger().with_variant(sa.Integer(), "sqlite"), autoincrement=True, nullable=False),
        sa.Column("session_uuid", sa.String(length=36), nullable=False),
        sa.Column("identity_id", sa.BigInteger(), nullable=False),
        sa.Column("operator_id", sa.BigInteger(), nullable=False),
        sa.Column("token_hash", sa.String(length=64), nullable=False),
        sa.Column("user_agent", sa.String(length=512), nullable=True),
        sa.Column("ip_address", sa.String(length=64), nullable=True),
        sa.Column("authenticated_at", sa.DateTime(), nullable=False),
        sa.Column("expires_at", sa.DateTime(), nullable=False),
        sa.Column("revoked_at", sa.DateTime(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=False),
        sa.Column("last_used_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["identity_id"], ["operator_identities.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["operator_id"], ["operators.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("session_uuid"),
        sa.UniqueConstraint("token_hash"),
    )
    op.create_index("idx_operator_sessions_operator_created", "operator_sessions", ["operator_id", "created_at"])
    op.create_index("idx_operator_sessions_expires", "operator_sessions", ["expires_at"])
    op.create_index("idx_operator_sessions_revoked", "operator_sessions", ["revoked_at"])

    # This pre-release migration makes operator audit attribution unambiguous.
    # Customer-backed transitional audit rows cannot be safely reattributed.
    op.execute("DELETE FROM ops_audit_events")
    op.drop_index("idx_ops_audit_events_actor_created", table_name="ops_audit_events")
    op.drop_constraint("ops_audit_events_actor_user_id_fkey", "ops_audit_events", type_="foreignkey")
    op.drop_column("ops_audit_events", "actor_user_id")
    op.add_column("ops_audit_events", sa.Column("actor_operator_id", sa.BigInteger(), nullable=True))
    op.add_column("ops_audit_events", sa.Column("actor_identity_provider", sa.String(length=64), nullable=True))
    op.add_column("ops_audit_events", sa.Column("actor_identity_issuer", sa.String(length=255), nullable=True))
    op.add_column("ops_audit_events", sa.Column("actor_identity_subject", sa.String(length=255), nullable=True))
    op.create_foreign_key(
        "ops_audit_events_actor_operator_id_fkey",
        "ops_audit_events",
        "operators",
        ["actor_operator_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("idx_ops_audit_events_actor_created", "ops_audit_events", ["actor_operator_id", "created_at"])


def downgrade() -> None:
    op.drop_index("idx_ops_audit_events_actor_created", table_name="ops_audit_events")
    op.drop_constraint("ops_audit_events_actor_operator_id_fkey", "ops_audit_events", type_="foreignkey")
    op.drop_column("ops_audit_events", "actor_identity_subject")
    op.drop_column("ops_audit_events", "actor_identity_issuer")
    op.drop_column("ops_audit_events", "actor_identity_provider")
    op.drop_column("ops_audit_events", "actor_operator_id")
    op.add_column("ops_audit_events", sa.Column("actor_user_id", sa.BigInteger(), nullable=True))
    op.create_foreign_key(
        "ops_audit_events_actor_user_id_fkey",
        "ops_audit_events",
        "users",
        ["actor_user_id"],
        ["id"],
        ondelete="SET NULL",
    )
    op.create_index("idx_ops_audit_events_actor_created", "ops_audit_events", ["actor_user_id", "created_at"])

    op.drop_index("idx_operator_sessions_revoked", table_name="operator_sessions")
    op.drop_index("idx_operator_sessions_expires", table_name="operator_sessions")
    op.drop_index("idx_operator_sessions_operator_created", table_name="operator_sessions")
    op.drop_table("operator_sessions")
    op.drop_table("operator_password_credentials")
    op.drop_index("idx_operator_identities_operator", table_name="operator_identities")
    op.drop_table("operator_identities")
    op.drop_index("idx_operators_status", table_name="operators")
    op.drop_table("operators")

    bind = op.get_bind()
    operator_identity_provider.drop(bind, checkfirst=True)
    operator_status.drop(bind, checkfirst=True)
    operator_role.drop(bind, checkfirst=True)
