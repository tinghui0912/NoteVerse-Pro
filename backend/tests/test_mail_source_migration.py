"""Persisted mail lineage upgrades without guessing recipient ownership."""

from datetime import timedelta
import pytest
from alembic import command
import sqlalchemy as sa
from sqlalchemy.orm import Session
from app.db.models import User, MailOutbox, MailOutboxStatus
from app.db.models.auth import AuthToken
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database


def old_insert(db, model):
    db.execute(
        sa.insert(type(model)).values(
            **model.model_dump(exclude={"source_kind", "source_id"}, exclude_none=True)
        )
    )


def legacy_mail(uuid, dedupe, *, status=MailOutboxStatus.PENDING):
    return MailOutbox(
        outbox_uuid=uuid,
        category="password.reset.requested",
        dedupe_key=dedupe,
        recipient="old@example.com",
        subject="Reset",
        text_body="private credential URL",
        status=status,
        completed_at=utc_now() if status == MailOutboxStatus.SENT else None,
    )


def test_upgrade_links_exact_source_and_invalidates_existing_closed_subject(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0006_erasure_failure_facts")
        with Session(engine) as db:
            for n in (1, 2):
                old_insert(
                    db,
                    User(
                        id=n,
                        email=f"user{n}@example.com",
                        password_hash="hash",
                        is_active=n == 2,
                        deleted_at=utc_now() if n == 1 else None,
                    ),
                )
                old_insert(
                    db,
                    AuthToken(
                        id=n,
                        user_id=n,
                        purpose="password_reset",
                        token_hash=str(n) * 64,
                        expires_at=utc_now() + timedelta(hours=1),
                    ),
                )
                old_insert(db, legacy_mail(f"mail-{n}", f"password.reset:{n}:{str(n) * 64}"))
            old_insert(
                db, legacy_mail("historical", "historical-mail", status=MailOutboxStatus.SENT)
            )
            db.commit()
        command.upgrade(config, "head")
        with Session(engine) as db:
            rows = {row.outbox_uuid: row for row in db.scalars(sa.select(MailOutbox))}
            assert len(rows) == 3
            assert rows["mail-1"].source_kind == "AUTH_TOKEN" and rows["mail-1"].source_id == 1
            assert (
                rows["mail-1"].status == MailOutboxStatus.CANCELLED
                and rows["mail-1"].recipient == ""
            )
            assert rows["mail-1"].failure_code is None
            assert db.get(AuthToken, 1).used_at is not None
            assert rows["mail-2"].status == MailOutboxStatus.PENDING and rows["mail-2"].text_body
            assert db.get(AuthToken, 2).used_at is None
            assert rows["historical"].status == MailOutboxStatus.SENT
            assert rows["historical"].recipient == "" and rows["historical"].text_body is None
        with pytest.raises(RuntimeError, match="cannot be discarded"):
            command.downgrade(config, "0006_erasure_failure_facts")


def test_unknown_active_lineage_refuses_upgrade_atomically(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "0006_erasure_failure_facts")
        with Session(engine) as db:
            old_insert(db, legacy_mail("unresolved-task", "unresolvable"))
            db.commit()
        with pytest.raises(RuntimeError, match="unresolved-task"):
            command.upgrade(config, "head")
        with engine.connect() as db:
            assert "source_id" not in {
                column["name"] for column in sa.inspect(db).get_columns("mail_outbox")
            }
            assert (
                db.scalar(sa.text("SELECT version_num FROM alembic_version"))
                == "0006_erasure_failure_facts"
            )
            assert (
                db.scalar(sa.text("SELECT text_body FROM mail_outbox")) == "private credential URL"
            )
        # Explicit source-owner resolution: preserve evidence, redact content, stop delivery.
        with engine.begin() as db:
            db.execute(
                sa.text(
                    "UPDATE mail_outbox SET status='EXPIRED',completed_at=now(),recipient='',text_body=null,html_body=null"
                )
            )
        command.upgrade(config, "head")
        with engine.connect() as db:
            assert db.scalar(sa.text("SELECT count(*) FROM mail_outbox")) == 1


def test_cancelled_delivery_evidence_blocks_downgrade(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            row = legacy_mail("cancelled", "cancelled", status=MailOutboxStatus.CANCELLED)
            row.source_kind, row.source_id = "ACCOUNT", 1
            db.add(row)
            db.commit()
        with pytest.raises(RuntimeError, match="cannot be discarded"):
            command.downgrade(config, "0006_erasure_failure_facts")
