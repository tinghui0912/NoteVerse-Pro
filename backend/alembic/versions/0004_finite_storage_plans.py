"""Finite User storage plans and a single plan-derived entitlement."""

from alembic import op
import sqlalchemy as sa

revision = "0004_finite_storage_plans"
down_revision = "0003_object_retirement_fence"
branch_labels = None
depends_on = None


def upgrade() -> None:
    db = op.get_bind()
    if db.scalar(
        sa.text("""
        SELECT EXISTS (SELECT 1 FROM storage_plan_policies WHERE mode <> 'HARD_LIMIT'
          OR default_limit_bytes IS NULL OR plan_code NOT IN ('FREE','PLUS','PRO'))
        OR EXISTS (SELECT 1 FROM user_storage_entitlements
          WHERE mode_override IS NOT NULL OR limit_override_bytes IS NOT NULL)
    """)
    ):
        raise RuntimeError(
            "Finite storage plans require supported finite policies and plan-derived entitlements; no unlimited/override value is converted implicitly"
        )
    op.drop_constraint(
        "ck_user_storage_entitlements_mode_limit", "user_storage_entitlements", type_="check"
    )
    op.drop_column("user_storage_entitlements", "mode_override")
    op.drop_column("user_storage_entitlements", "limit_override_bytes")
    op.drop_constraint(
        "ck_storage_plan_policies_mode_limit", "storage_plan_policies", type_="check"
    )
    op.drop_column("storage_plan_policies", "mode")
    op.alter_column("storage_plan_policies", "default_limit_bytes", nullable=False)
    op.create_check_constraint(
        "ck_storage_plan_policies_limit_nonnegative",
        "storage_plan_policies",
        "default_limit_bytes >= 0",
    )
    op.create_check_constraint(
        "ck_storage_plan_policy_code", "storage_plan_policies", "plan_code IN ('FREE','PLUS','PRO')"
    )
    # The database policy is the runtime capacity authority; these are initial configuration.
    op.execute("""INSERT INTO storage_plan_policies(plan_code,default_limit_bytes,created_at,updated_at)
        VALUES ('PLUS',5368709120,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP),
               ('PRO',21474836480,CURRENT_TIMESTAMP,CURRENT_TIMESTAMP)
        ON CONFLICT (plan_code) DO NOTHING""")


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text("SELECT EXISTS(SELECT 1 FROM user_storage_entitlements WHERE plan_code <> 'FREE')")
    ):
        raise RuntimeError(
            "Referenced PLUS/PRO entitlements prevent removing finite plan configuration"
        )
    op.execute("DELETE FROM storage_plan_policies WHERE plan_code IN ('PLUS','PRO')")
    op.drop_constraint("ck_storage_plan_policy_code", "storage_plan_policies", type_="check")
    op.drop_constraint(
        "ck_storage_plan_policies_limit_nonnegative", "storage_plan_policies", type_="check"
    )
    op.alter_column("storage_plan_policies", "default_limit_bytes", nullable=True)
    op.add_column("storage_plan_policies", sa.Column("mode", sa.String(16), nullable=True))
    op.execute("UPDATE storage_plan_policies SET mode='HARD_LIMIT'")
    op.alter_column("storage_plan_policies", "mode", nullable=False)
    op.create_check_constraint(
        "ck_storage_plan_policies_mode_limit",
        "storage_plan_policies",
        "(mode = 'HARD_LIMIT' AND default_limit_bytes IS NOT NULL AND default_limit_bytes >= 0) OR (mode = 'UNLIMITED' AND default_limit_bytes IS NULL)",
    )
    op.add_column(
        "user_storage_entitlements", sa.Column("mode_override", sa.String(16), nullable=True)
    )
    op.add_column(
        "user_storage_entitlements",
        sa.Column("limit_override_bytes", sa.BigInteger(), nullable=True),
    )
    op.create_check_constraint(
        "ck_user_storage_entitlements_mode_limit",
        "user_storage_entitlements",
        "(mode_override IS NULL AND limit_override_bytes IS NULL) OR (mode_override IS NOT NULL AND mode_override = 'HARD_LIMIT' AND limit_override_bytes IS NOT NULL AND limit_override_bytes >= 0) OR (mode_override IS NOT NULL AND mode_override = 'UNLIMITED' AND limit_override_bytes IS NULL)",
    )
