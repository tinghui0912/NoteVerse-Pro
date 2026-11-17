"""PostgreSQL hash-only credential invariants and serialized lifecycle commands."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from time import monotonic, sleep

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError
from app.core.exceptions import ConflictException
from app.db.models import GuestPreviewCredential, Score, User
from app.modules.guest_previews.credentials import guest_preview_token_hash
from app.modules.guest_previews.service import GuestPreviewService
from tests.support.postgres_schema import postgres_schema_database


@pytest.fixture
def credential_database(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            user = User(email="credential@example.test", password_hash="hash")
            db.add(user)
            db.flush()
            owner_id = user.id
            db.add(Score(score_uuid="preview", owner_user_id=owner_id, display_title="Preview"))
            db.commit()
        yield engine, owner_id


def test_fresh_postgres_credential_constraints(credential_database):
    engine, owner = credential_database
    inspector = sa.inspect(engine)
    score_columns = {c["name"] for c in inspector.get_columns("scores")}
    assert "guest_preview_token" not in score_columns
    assert "guest_preview_enabled" not in score_columns
    columns = {c["name"]: c for c in inspector.get_columns("guest_preview_credentials")}
    assert set(columns) == {"id", "score_id", "token_hash", "issued_at"}
    assert all(not c["nullable"] for c in columns.values())
    assert {
        tuple(c["column_names"])
        for c in inspector.get_unique_constraints("guest_preview_credentials")
    } == {("score_id",), ("token_hash",)}
    fk = inspector.get_foreign_keys("guest_preview_credentials")[0]
    assert fk["referred_table"] == "scores" and fk["options"]["ondelete"] == "CASCADE"
    service = GuestPreviewService()
    with Session(engine) as db:
        issued = service.issue_credential(db, "preview", owner)
        row = db.scalar(sa.select(GuestPreviewCredential))
        score_id = row.score_id
        assert row.token_hash == guest_preview_token_hash(issued.token) != issued.token
        for values in [
            {"token_hash": None},
            {"issued_at": None},
            {"score_id": None},
            {"token_hash": "short"},
        ]:
            with pytest.raises(IntegrityError):
                db.execute(sa.update(GuestPreviewCredential).values(**values))
                db.commit()
            db.rollback()
        for other_score, hash_value in [
            (score_id, "a" * 64),
            (None, guest_preview_token_hash(issued.token)),
        ]:
            if other_score is None:
                score = Score(score_uuid="other", owner_user_id=owner, display_title="Other")
                db.add(score)
                db.flush()
                other_score = score.id
            db.add(GuestPreviewCredential(score_id=other_score, token_hash=hash_value))
            with pytest.raises(IntegrityError):
                db.commit()
            db.rollback()
        db.execute(sa.delete(Score).where(Score.id == score_id))
        db.commit()
        assert db.scalar(sa.select(GuestPreviewCredential)) is None


@pytest.mark.parametrize(
    "first,second", [("issue", "issue"), ("rotate", "revoke"), ("revoke", "rotate")]
)
def test_credential_commands_serialize_on_score_before_credential(
    credential_database, first, second
):
    engine, owner = credential_database
    service = GuestPreviewService()
    with Session(engine) as db:
        original = (
            service.issue_credential(db, "preview", owner).token if first != "issue" else None
        )
    entered = Event()
    pid = []

    def waiting_command():
        with Session(engine) as db:
            pid.append(db.scalar(sa.text("SELECT pg_backend_pid()")))
            entered.set()
            try:
                return getattr(service, second + "_credential")(db, "preview", owner)
            except ConflictException as exc:
                return exc.code

    with ThreadPoolExecutor(max_workers=1) as pool, Session(engine) as winner:
        winner.scalar(sa.select(Score).with_for_update())
        future = pool.submit(waiting_command)
        try:
            assert entered.wait(10)
            deadline = monotonic() + 10
            with engine.connect() as observer:
                while monotonic() < deadline:
                    waiting = observer.scalar(
                        sa.text("SELECT wait_event_type FROM pg_stat_activity WHERE pid=:pid"),
                        {"pid": pid[0]},
                    )
                    if waiting == "Lock":
                        break
                    sleep(0.01)
                else:
                    pytest.fail("Concurrent credential command must wait for the Score row lock")
            assert not future.done()
            result = getattr(service, first + "_credential")(winner, "preview", owner)
        finally:
            winner.rollback()
        outcome = future.result(timeout=10)
    with Session(engine) as db:
        row = db.scalar(sa.select(GuestPreviewCredential))
        if first == "issue":
            assert outcome == "guest_preview_already_enabled"
            assert row.token_hash == guest_preview_token_hash(result.token)
        else:
            assert row is None
            if first == "revoke":
                assert outcome == "guest_preview_not_enabled"
            else:
                assert outcome is None
                assert result.token != original
