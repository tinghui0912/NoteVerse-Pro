"""Forward migration preserves owner history and refuses invented downgrade data."""

from datetime import timedelta
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from alembic import command
from app.db.models import (
    User,
    Score,
    ScoreInvite,
    ScoreMembership,
    MailOutbox,
    AccountDeletionOperation,
)
from app.db.models.score_access import InviteTerminalOutcome as Outcome, MembershipRole
from app.db.models.mail_outbox import MailOutboxStatus
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database


def insert_old(db, row):
    db.execute(sa.insert(type(row)).values(**row.model_dump(exclude_none=True)))


def test_populated_upgrade_anonymizes_closed_identity_and_preserves_new_invitation(monkeypatch):
    closed_at = utc_now()
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0007_mail_source_lifecycle")
        with Session(engine) as db:
            for n, name in [(1, "alice"), (2, "bob"), (3, "carol")]:
                insert_old(
                    db,
                    User(
                        id=n,
                        email=f"{name}@example.com",
                        password_hash="hash",
                        is_active=n != 1,
                        deleted_at=closed_at if n == 1 else None,
                    ),
                )
            insert_old(
                db, Score(id=1, score_uuid="bob-score", owner_user_id=2, display_title="Preserved")
            )
            insert_old(
                db,
                AccountDeletionOperation(
                    user_id=1, user_id_snapshot=1, operation_uuid="existing-operation"
                ),
            )
            values = [
                (1, 2, "alice@example.com", None, None, closed_at - timedelta(days=2)),
                (2, 2, "alice@example.com", "ACCEPTED", 1, closed_at - timedelta(days=2)),
                (3, 1, "carol@example.com", None, None, closed_at + timedelta(seconds=1)),
                (4, 1, "carol@example.com", "ACCEPTED", 1, closed_at - timedelta(days=2)),
                (5, 2, "alice@example.com", None, None, closed_at + timedelta(seconds=1)),
                (6, 1, "alice@example.com", None, None, closed_at - timedelta(days=2)),
                (7, 2, "carol@example.com", "DECLINED", 1, closed_at - timedelta(days=2)),
            ]
            for n, creator, email, outcome, actor, created in values:
                insert_old(
                    db,
                    ScoreInvite(
                        id=n,
                        score_id=1,
                        invite_uuid=f"invite-{n}",
                        created_by_user_id=creator,
                        email=email,
                        token_hash=str(n) * 64,
                        role=MembershipRole.VIEWER,
                        created_at=created,
                        expires_at=closed_at - timedelta(seconds=1)
                        if n == 1
                        else closed_at + timedelta(days=1),
                        terminal_outcome=Outcome(outcome) if outcome else None,
                        terminal_at=closed_at - timedelta(days=1) if outcome else None,
                        terminal_actor_user_id=actor,
                    ),
                )
                if n <= 6:
                    insert_old(
                        db,
                        MailOutbox(
                            source_kind="SCORE_INVITE",
                            source_id=n,
                            outbox_uuid=f"mail-{n}",
                            category="score.invite",
                            dedupe_key=f"score-invite:invite-{n}",
                            recipient=email,
                            subject="Private subject",
                            text_body="Credential link",
                            status=MailOutboxStatus.SENT if outcome else MailOutboxStatus.PENDING,
                            completed_at=closed_at - timedelta(hours=1) if outcome else None,
                        ),
                    )
            insert_old(
                db,
                ScoreMembership(
                    id=1, score_id=1, user_id=1, role=MembershipRole.VIEWER, created_by_user_id=2
                ),
            )
            insert_old(
                db,
                ScoreMembership(
                    id=2, score_id=1, user_id=3, role=MembershipRole.EDITOR, created_by_user_id=1
                ),
            )
            db.commit()
        command.upgrade(config, "head")
        with Session(engine) as db:
            rows = {row.id: row for row in db.scalars(sa.select(ScoreInvite))}
            assert rows[1].terminal_outcome == Outcome.RECIPIENT_ACCOUNT_CLOSED
            assert rows[3].terminal_outcome == Outcome.INVITER_ACCOUNT_CLOSED
            assert rows[6].terminal_outcome == Outcome.RECIPIENT_ACCOUNT_CLOSED
            for n in (1, 2, 3, 4, 6):
                assert rows[n].email is rows[n].token_hash is None
            for n in (2, 4):
                assert rows[n].terminal_outcome == Outcome.ACCEPTED
                assert rows[n].terminal_at == closed_at - timedelta(days=1)
                assert rows[n].terminal_actor_user_id is None
            assert (
                rows[7].terminal_outcome == Outcome.DECLINED
                and rows[7].email == "carol@example.com"
            )
            assert rows[7].terminal_actor_user_id is None
            assert (
                rows[5].terminal_outcome is None
                and rows[5].email == "alice@example.com"
                and rows[5].token_hash == "5" * 64
            )
            assert (
                rows[3].created_by_user_id
                is rows[4].created_by_user_id
                is rows[6].created_by_user_id
                is None
            )
            for row in db.scalars(sa.select(MailOutbox)):
                if row.source_id == 5:
                    assert row.status.value == "PENDING" and row.text_body == "Credential link"
                else:
                    assert row.status.value == ("SENT" if row.source_id in (2, 4) else "CANCELLED")
                    assert row.recipient == row.subject == "" and row.text_body is None
            member = db.get(ScoreMembership, 2)
            assert (
                member.user_id == 3
                and member.role.value == "EDITOR"
                and member.created_by_user_id is None
            )
            assert db.get(ScoreMembership, 1).user_id == 1
            assert db.get(Score, 1).display_title == "Preserved"
            operation = db.scalar(sa.select(AccountDeletionOperation))
            assert (
                operation.operation_uuid == "existing-operation"
                and operation.phase.value == "SCORES"
            )
        with pytest.raises(RuntimeError, match="cannot be reconstructed"):
            command.downgrade(config, "0007_mail_source_lifecycle")
        with engine.connect() as db:
            assert (
                db.scalar(sa.text("SELECT version_num FROM alembic_version"))
                == "0008_collaboration_closure"
            )
            assert db.scalar(sa.text("SELECT count(*) FROM score_invites")) == 7
            assert db.scalar(sa.text("SELECT count(*) FROM mail_outbox")) == 6


def test_lossless_active_history_roundtrip_and_creator_fk_delete_policy(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0007_mail_source_lifecycle")
        with Session(engine) as db:
            for n in (1, 2, 3):
                insert_old(db, User(id=n, email=f"user{n}@example.com", password_hash="hash"))
            insert_old(
                db, Score(id=1, score_uuid="retained", owner_user_id=2, display_title="Owner")
            )
            insert_old(
                db,
                ScoreInvite(
                    id=1,
                    score_id=1,
                    invite_uuid="pending",
                    created_by_user_id=1,
                    email="target@example.com",
                    token_hash="a" * 64,
                    role=MembershipRole.VIEWER,
                ),
            )
            insert_old(
                db,
                ScoreMembership(
                    id=1, score_id=1, user_id=3, created_by_user_id=1, role=MembershipRole.EDITOR
                ),
            )
            db.commit()
        command.upgrade(config, "head")
        inspector = sa.inspect(engine)
        for table in ("score_invites", "score_memberships"):
            fk = next(
                fk
                for fk in inspector.get_foreign_keys(table)
                if fk["constrained_columns"] == ["created_by_user_id"]
            )
            assert fk["options"]["ondelete"] == "SET NULL"
        command.downgrade(config, "0007_mail_source_lifecycle")
        with engine.connect() as db:
            assert db.scalar(sa.text("SELECT token_hash FROM score_invites")) == "a" * 64
        command.upgrade(config, "head")
        # Deliberately exercise database attribution behavior, not application erasure.
        with engine.begin() as db:
            db.execute(sa.text("DELETE FROM users WHERE id=1"))
        with Session(engine) as db:
            assert db.get(ScoreInvite, 1).created_by_user_id is None
            assert db.get(ScoreMembership, 1).created_by_user_id is None
            assert db.get(ScoreMembership, 1).user_id == 3
            assert db.get(Score, 1).owner_user_id == 2
