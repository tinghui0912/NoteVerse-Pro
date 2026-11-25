"""Bind mail delivery to explicit domain source identity and terminal cancellation."""

from alembic import op
import sqlalchemy as sa

revision = "0007_mail_source_lifecycle"
down_revision = "0006_erasure_failure_facts"
branch_labels = None
depends_on = None

SOURCE_CHECK = "(source_kind IS NULL AND source_id IS NULL AND CAST(status AS TEXT) IN ('SENT','PERMANENT_FAILURE','EXPIRED','CANCELLED')) OR (source_kind IS NOT NULL AND source_id IS NOT NULL AND source_kind IN ('ACCOUNT','AUTH_TOKEN','EMAIL_CHANGE','REGISTRATION','SCORE_INVITE') AND source_id > 0)"


def upgrade() -> None:
    op.add_column("mail_outbox", sa.Column("source_kind", sa.String(32)))
    op.add_column("mail_outbox", sa.Column("source_id", sa.BigInteger()))
    # Match persisted domain identities, not recipient addresses or guessed ownership.
    op.execute("""UPDATE mail_outbox m SET source_kind='SCORE_INVITE', source_id=i.id
        FROM score_invites i WHERE m.category='score.invite' AND m.dedupe_key='score-invite:' || i.invite_uuid""")
    op.execute("""UPDATE mail_outbox m SET source_kind='AUTH_TOKEN', source_id=t.id
        FROM auth_tokens t WHERE m.category='password.reset.requested'
        AND m.dedupe_key='password.reset:' || t.user_id::text || ':' || t.token_hash""")
    op.execute("""UPDATE mail_outbox m SET source_kind='EMAIL_CHANGE', source_id=r.id
        FROM email_change_requests r WHERE m.category='email.change.requested'
        AND m.dedupe_key='email.change:' || r.user_id::text || ':' || r.token_hash""")
    op.execute("""UPDATE mail_outbox m SET source_kind='REGISTRATION', source_id=r.id
        FROM pending_registrations r WHERE m.category='verification.email'
        AND m.dedupe_key='verification.email:' || r.email || ':' || r.token_hash""")
    op.execute("""UPDATE mail_outbox m SET source_kind='ACCOUNT', source_id=u.id
        FROM users u WHERE m.category IN ('password.changed','password.reset.completed','email.change.completed')
        AND split_part(m.dedupe_key,':',1)=m.category AND split_part(m.dedupe_key,':',2)=u.id::text""")
    unresolved = list(
        op.get_bind().scalars(
            sa.text("""SELECT outbox_uuid FROM mail_outbox
        WHERE source_id IS NULL AND status IN ('PENDING','DISPATCHED','PROCESSING','FAILED') ORDER BY id LIMIT 20""")
        )
    )
    if unresolved:
        raise RuntimeError(
            "Active mail source lineage cannot be established; resolve source ownership before upgrade. Outbox IDs: "
            + ", ".join(unresolved)
        )
    # Replace the enum transactionally so CANCELLED is usable in this same upgrade.
    # No autocommit gap may expose partially backfilled delivery lineage.
    op.drop_constraint("ck_mail_outbox_attempt_token", "mail_outbox", type_="check")
    op.execute("ALTER TYPE mailoutboxstatus RENAME TO mailoutboxstatus_without_cancel")
    op.execute(
        "CREATE TYPE mailoutboxstatus AS ENUM ('PENDING','DISPATCHED','PROCESSING','SENT','FAILED','PERMANENT_FAILURE','EXPIRED','CANCELLED')"
    )
    op.execute(
        "ALTER TABLE mail_outbox ALTER COLUMN status TYPE mailoutboxstatus USING status::text::mailoutboxstatus"
    )
    op.execute("DROP TYPE mailoutboxstatus_without_cancel")
    op.create_check_constraint(
        "ck_mail_outbox_attempt_token",
        "mail_outbox",
        "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status != 'PROCESSING' AND attempt_token IS NULL)",
    )
    # Existing closures must immediately invalidate credentials too; preserve rows.
    op.execute("""UPDATE auth_tokens t SET used_at=coalesce(t.used_at,now()) FROM users u
        WHERE t.user_id=u.id AND (NOT u.is_active OR u.deleted_at IS NOT NULL)""")
    op.execute("""UPDATE email_change_requests r SET consumed_at=coalesce(r.consumed_at,now()) FROM users u
        WHERE r.user_id=u.id AND (NOT u.is_active OR u.deleted_at IS NOT NULL)""")
    # Invalid source-linked credentials cannot resume merely because an old task survived.
    op.execute("""UPDATE mail_outbox m SET status='CANCELLED', attempt_token=null,
        completed_at=now(), updated_at=now(), failure_code=null,
        failure_stage=null, failure_classification=null, failure_retryable=null,
        recipient='', subject='', text_body=null, html_body=null, failure_detail=null,
        provider_message_id=null, dedupe_key='erased:' || m.outbox_uuid
        WHERE status IN ('PENDING','DISPATCHED','PROCESSING','FAILED') AND (
          (source_kind='ACCOUNT' AND NOT EXISTS(SELECT 1 FROM users u WHERE u.id=m.source_id AND u.is_active AND u.deleted_at IS NULL)) OR
          (source_kind='AUTH_TOKEN' AND NOT EXISTS(SELECT 1 FROM auth_tokens t JOIN users u ON u.id=t.user_id WHERE t.id=m.source_id AND t.used_at IS NULL AND t.expires_at>now() AND u.is_active AND u.deleted_at IS NULL)) OR
          (source_kind='EMAIL_CHANGE' AND NOT EXISTS(SELECT 1 FROM email_change_requests r JOIN users u ON u.id=r.user_id WHERE r.id=m.source_id AND r.consumed_at IS NULL AND r.expires_at>now() AND u.is_active AND u.deleted_at IS NULL)) OR
          (source_kind='REGISTRATION' AND NOT EXISTS(SELECT 1 FROM pending_registrations r WHERE r.id=m.source_id AND r.consumed_at IS NULL AND r.expires_at>now())) OR
          (source_kind='SCORE_INVITE' AND NOT EXISTS(SELECT 1 FROM score_invites i JOIN scores s ON s.id=i.score_id JOIN users u ON u.id=s.owner_user_id WHERE i.id=m.source_id AND i.terminal_outcome IS NULL AND (i.expires_at IS NULL OR i.expires_at>now()) AND s.deleted_at IS NULL AND u.is_active AND u.deleted_at IS NULL AND EXISTS(SELECT 1 FROM users issuer WHERE issuer.id=i.created_by_user_id AND issuer.is_active AND issuer.deleted_at IS NULL)))
        )""")
    # Completed evidence without a surviving source remains terminal, with no contact/payload.
    op.execute("""UPDATE mail_outbox SET recipient='', subject='', text_body=null, html_body=null,
        dedupe_key='erased:' || outbox_uuid, failure_detail=null, provider_message_id=null
        WHERE source_id IS NULL""")
    op.create_index("idx_mail_outbox_source", "mail_outbox", ["source_kind", "source_id"])
    op.create_check_constraint("ck_mail_outbox_source", "mail_outbox", SOURCE_CHECK)


def downgrade() -> None:
    if op.get_bind().scalar(
        sa.text(
            "SELECT EXISTS(SELECT 1 FROM mail_outbox WHERE source_id IS NOT NULL OR status::text='CANCELLED')"
        )
    ):
        raise RuntimeError("Mail source/cancellation evidence cannot be discarded by downgrade")
    op.drop_constraint("ck_mail_outbox_source", "mail_outbox", type_="check")
    op.drop_index("idx_mail_outbox_source", table_name="mail_outbox")
    op.drop_column("mail_outbox", "source_id")
    op.drop_column("mail_outbox", "source_kind")
    op.drop_constraint("ck_mail_outbox_attempt_token", "mail_outbox", type_="check")
    op.execute("ALTER TYPE mailoutboxstatus RENAME TO mailoutboxstatus_with_cancel")
    op.execute(
        "CREATE TYPE mailoutboxstatus AS ENUM ('PENDING','DISPATCHED','PROCESSING','SENT','FAILED','PERMANENT_FAILURE','EXPIRED')"
    )
    op.execute(
        "ALTER TABLE mail_outbox ALTER COLUMN status TYPE mailoutboxstatus USING status::text::mailoutboxstatus"
    )
    op.execute("DROP TYPE mailoutboxstatus_with_cancel")
    op.create_check_constraint(
        "ck_mail_outbox_attempt_token",
        "mail_outbox",
        "(status = 'PROCESSING' AND attempt_token IS NOT NULL) OR (status != 'PROCESSING' AND attempt_token IS NULL)",
    )
