"""Retain collaboration history while closing identity-bound invitations."""

from alembic import op
import sqlalchemy as sa

revision = "0008_collaboration_closure"
down_revision = "0007_mail_source_lifecycle"
branch_labels = None
depends_on = None

TERMINAL_CHECK = "(terminal_outcome IS NULL AND terminal_at IS NULL AND terminal_actor_user_id IS NULL) OR (terminal_outcome IS NOT NULL AND terminal_at IS NOT NULL)"
CONTACT_CHECK = "(email IS NOT NULL AND token_hash IS NOT NULL) OR (terminal_outcome IS NOT NULL AND email IS NULL AND token_hash IS NULL)"
CLOSED_CHECK = "(terminal_outcome NOT IN ('RECIPIENT_ACCOUNT_CLOSED','INVITER_ACCOUNT_CLOSED') OR (email IS NULL AND token_hash IS NULL AND terminal_actor_user_id IS NULL)) AND (terminal_outcome != 'INVITER_ACCOUNT_CLOSED' OR created_by_user_id IS NULL)"


def upgrade() -> None:
    op.drop_constraint("ck_score_invites_terminal_facts", "score_invites", type_="check")
    # Transactional enum replacement allows the new values in this upgrade's backfill.
    op.execute("ALTER TYPE inviteterminaloutcome RENAME TO inviteterminaloutcome_before_closure")
    op.execute(
        "CREATE TYPE inviteterminaloutcome AS ENUM ('ACCEPTED','DECLINED','REVOKED','RECIPIENT_ACCOUNT_CLOSED','INVITER_ACCOUNT_CLOSED')"
    )
    op.execute(
        "ALTER TABLE score_invites ALTER COLUMN terminal_outcome TYPE inviteterminaloutcome USING terminal_outcome::text::inviteterminaloutcome"
    )
    op.execute("DROP TYPE inviteterminaloutcome_before_closure")
    for table in ("score_invites", "score_memberships"):
        op.drop_constraint(f"fk_{table}_created_by_user_id_users", table, type_="foreignkey")
        op.alter_column(table, "created_by_user_id", existing_type=sa.BigInteger(), nullable=True)
        op.create_foreign_key(
            f"fk_{table}_created_by_user_id_users",
            table,
            "users",
            ["created_by_user_id"],
            ["id"],
            ondelete="SET NULL",
        )
    for field, kind in (("email", sa.String(255)), ("token_hash", sa.String(64))):
        op.alter_column("score_invites", field, existing_type=kind, nullable=True)
    # Source identity is captured before contact/creator removal. No recipient-mail ownership inference.
    affected = """SELECT i.id FROM score_invites i WHERE
        EXISTS(SELECT 1 FROM users u WHERE u.deleted_at IS NOT NULL AND ((i.email=lower(trim(u.email)) AND i.created_at<=u.deleted_at) OR i.created_by_user_id=u.id))
        OR EXISTS(SELECT 1 FROM scores s JOIN users u ON u.id=s.owner_user_id WHERE s.id=i.score_id AND u.deleted_at IS NOT NULL)"""
    op.execute(
        sa.text(f"""UPDATE mail_outbox SET status='CANCELLED',attempt_token=null,completed_at=now(),updated_at=now(),failure_code=null,failure_stage=null,failure_classification=null,failure_retryable=null,failure_detail=null
        WHERE source_kind='SCORE_INVITE' AND source_id IN ({affected}) AND status IN ('PENDING','DISPATCHED','PROCESSING','FAILED')""")
    )
    op.execute(
        sa.text(f"""UPDATE mail_outbox SET recipient='',subject='',text_body=null,html_body=null,provider_message_id=null,failure_detail=null,dedupe_key='erased:' || outbox_uuid
        WHERE source_kind='SCORE_INVITE' AND source_id IN ({affected})""")
    )
    # Unique User email makes recipient closure unambiguous; recipient wins over issuer.
    op.execute("""WITH closure AS (
        SELECT i.id, r.deleted_at AS recipient_closed_at, c.deleted_at AS creator_closed_at
        FROM score_invites i
        LEFT JOIN users r ON i.email=lower(trim(r.email)) AND i.created_at<=r.deleted_at
        LEFT JOIN users c ON c.id=i.created_by_user_id AND c.deleted_at IS NOT NULL
        WHERE r.deleted_at IS NOT NULL OR c.deleted_at IS NOT NULL
    ) UPDATE score_invites i SET
        terminal_outcome=CASE WHEN i.terminal_outcome IS NOT NULL THEN i.terminal_outcome
            WHEN x.recipient_closed_at IS NOT NULL THEN 'RECIPIENT_ACCOUNT_CLOSED'::inviteterminaloutcome ELSE 'INVITER_ACCOUNT_CLOSED'::inviteterminaloutcome END,
        terminal_at=CASE WHEN i.terminal_outcome IS NULL THEN coalesce(x.recipient_closed_at,x.creator_closed_at) ELSE i.terminal_at END,
        terminal_actor_user_id=CASE WHEN i.terminal_outcome IS NULL OR EXISTS(SELECT 1 FROM users u WHERE u.id=i.terminal_actor_user_id AND u.deleted_at IS NOT NULL) THEN null ELSE i.terminal_actor_user_id END,
        created_by_user_id=CASE WHEN x.creator_closed_at IS NOT NULL THEN null ELSE i.created_by_user_id END,
        email=null,token_hash=null FROM closure x WHERE i.id=x.id""")
    op.execute(
        "UPDATE score_invites SET terminal_actor_user_id=null WHERE terminal_actor_user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)"
    )
    op.execute(
        "UPDATE score_memberships SET created_by_user_id=null WHERE created_by_user_id IN (SELECT id FROM users WHERE deleted_at IS NOT NULL)"
    )
    op.create_check_constraint("ck_score_invites_terminal_facts", "score_invites", TERMINAL_CHECK)
    op.create_check_constraint("ck_score_invites_contact_facts", "score_invites", CONTACT_CHECK)
    op.create_check_constraint("ck_score_invites_closed_facts", "score_invites", CLOSED_CHECK)
    op.create_index(
        "idx_score_invites_recipient_created", "score_invites", ["email", "created_at", "id"]
    )
    op.create_index("idx_score_invites_creator", "score_invites", ["created_by_user_id", "id"])
    op.create_index(
        "idx_score_invites_terminal_actor", "score_invites", ["terminal_actor_user_id", "id"]
    )
    op.create_index(
        "idx_score_memberships_creator", "score_memberships", ["created_by_user_id", "id"]
    )


def downgrade() -> None:
    connection = op.get_bind()
    if connection.scalar(
        sa.text(
            """SELECT EXISTS(SELECT 1 FROM score_invites WHERE email IS NULL OR token_hash IS NULL OR created_by_user_id IS NULL OR (terminal_outcome IS NOT NULL AND terminal_actor_user_id IS NULL) OR terminal_outcome::text IN ('RECIPIENT_ACCOUNT_CLOSED','INVITER_ACCOUNT_CLOSED')) OR EXISTS(SELECT 1 FROM score_memberships WHERE created_by_user_id IS NULL)"""
        )
    ):
        raise RuntimeError("Anonymized collaboration history cannot be reconstructed for downgrade")
    for name in ("closed", "contact", "terminal"):
        op.drop_constraint(f"ck_score_invites_{name}_facts", "score_invites", type_="check")
    op.drop_index("idx_score_memberships_creator", table_name="score_memberships")
    op.drop_index("idx_score_invites_terminal_actor", table_name="score_invites")
    op.drop_index("idx_score_invites_creator", table_name="score_invites")
    op.drop_index("idx_score_invites_recipient_created", table_name="score_invites")
    op.execute("ALTER TYPE inviteterminaloutcome RENAME TO inviteterminaloutcome_with_closure")
    op.execute("CREATE TYPE inviteterminaloutcome AS ENUM ('ACCEPTED','DECLINED','REVOKED')")
    op.execute(
        "ALTER TABLE score_invites ALTER COLUMN terminal_outcome TYPE inviteterminaloutcome USING terminal_outcome::text::inviteterminaloutcome"
    )
    op.execute("DROP TYPE inviteterminaloutcome_with_closure")
    for table in ("score_invites", "score_memberships"):
        op.drop_constraint(f"fk_{table}_created_by_user_id_users", table, type_="foreignkey")
        op.alter_column(table, "created_by_user_id", existing_type=sa.BigInteger(), nullable=False)
        op.create_foreign_key(
            f"fk_{table}_created_by_user_id_users", table, "users", ["created_by_user_id"], ["id"]
        )
    for field, kind in (("email", sa.String(255)), ("token_hash", sa.String(64))):
        op.alter_column("score_invites", field, existing_type=kind, nullable=False)
    op.create_check_constraint(
        "ck_score_invites_terminal_facts",
        "score_invites",
        "(terminal_outcome IS NULL AND terminal_at IS NULL AND terminal_actor_user_id IS NULL) OR (terminal_outcome IS NOT NULL AND terminal_at IS NOT NULL AND terminal_actor_user_id IS NOT NULL)",
    )
