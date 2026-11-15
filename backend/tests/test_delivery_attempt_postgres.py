"""Real row locks, lease takeover and durable outcomes for domain deliveries."""

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import replace
from datetime import timedelta
from threading import Event
from time import monotonic
from unittest.mock import Mock

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db.models import (
    ImportDispatch,
    ImportJob,
    MailOutbox,
    ObjectWriteIntent,
    PlaybackOutbox,
    RenderOutbox,
    RenderTargetType,
    Score,
    ScoreDeletionOperation,
    ScoreRevision,
    ScoreRevisionSource,
    StoredObject,
    StoredObjectRetirement,
    User,
)
from app.db.models.score import RevisionOrigin, RevisionSourceFormat
from app.db.models.import_job import ImportJobState
from app.modules.mail.outbox_service import mail_outbox_service
from app.modules.playback.outbox_service import playback_outbox_service
from app.modules.revisions.presentation_demand import RevisionPresentationSuperseded
from app.modules.score_assets.render_outbox_service import render_outbox_service
from app.utils.timezone import utc_now_naive
from tests.support.postgres_schema import postgres_schema_database

SERVICES = {
    "render": (RenderOutbox, render_outbox_service),
    "playback": (PlaybackOutbox, playback_outbox_service),
    "mail": (MailOutbox, mail_outbox_service),
}


@pytest.fixture
def database(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            user = User(email="lease@example.test", password_hash="hash")
            db.add(user)
            db.flush()
            score = Score(score_uuid="score", owner_user_id=user.id, title="Score")
            db.add(score)
            db.flush()
            revision = ScoreRevision(
                revision_uuid="revision",
                score_id=score.id,
                revision_number=1,
                content_hash="f" * 64,
                origin=RevisionOrigin.EDIT,
            )
            job = ImportJob(job_uuid="job", user_id=user.id, state=ImportJobState.PENDING)
            db.add_all([revision, job])
            db.flush()
            score.head_revision_id = revision.id
            db.add(
                ScoreRevisionSource(
                    source_uuid="source",
                    revision_id=revision.id,
                    format=RevisionSourceFormat.MUSICXML,
                    filename="score.musicxml",
                    generator="test",
                    generator_version="1",
                    stored_object=StoredObject(
                        object_key="source",
                        byte_size=1,
                        sha256="f" * 64,
                        content_type="application/vnd.recordare.musicxml+xml",
                    ),
                )
            )
            db.add_all(
                [
                    RenderOutbox(
                        outbox_uuid="render",
                        target_type=RenderTargetType.SCORE_REVISION,
                        score_id=score.id,
                        revision_id=revision.id,
                        requested_by_user_id=user.id,
                        source_fingerprint="f" * 64,
                    ),
                    PlaybackOutbox(
                        outbox_uuid="playback",
                        score_id=score.id,
                        revision_id=revision.id,
                        requested_by_user_id=user.id,
                        source_fingerprint="f" * 64,
                    ),
                    MailOutbox(
                        outbox_uuid="mail",
                        category="test",
                        dedupe_key="mail",
                        recipient="reader@example.test",
                        subject="Mail",
                        text_body="Body",
                        expires_at=utc_now_naive() + timedelta(days=1),
                    ),
                    ImportDispatch(job_id=job.id),
                    ScoreDeletionOperation(
                        score_id=score.id, score_uuid=score.score_uuid, owner_user_id=user.id
                    ),
                    StoredObjectRetirement(
                        object_key="unowned",
                        byte_size=1,
                        sha256="f" * 64,
                        content_type="application/octet-stream",
                    ),
                    ObjectWriteIntent(
                        object_key="write",
                        byte_size=1,
                        sha256="f" * 64,
                        content_type="application/octet-stream",
                        write_token="generation",
                        write_expires_at=utc_now_naive() + timedelta(days=1),
                    ),
                ]
            )
            db.commit()
        yield engine


def snapshot(db, model):
    row = db.scalars(sa.select(model).execution_options(populate_existing=True)).one()
    return {column.name: getattr(row, column.name) for column in model.__table__.columns}


def takeover(engine, kind):
    model, service = SERVICES[kind]
    with Session(engine) as db:
        row = db.scalars(sa.select(model)).one()
        row.started_at = utc_now_naive() - timedelta(days=1)
        db.commit()
        assert kind in service.recover_and_list_due(db)
        db.commit()
        db.refresh(row)
        assert row.status.value == "FAILED" and row.attempt_token is None
        payload = service.claim(db, kind)
        db.commit()
        assert payload is not None and payload.lease.attempt == 2
        return payload.lease


def outcome(db, kind, action, lease):
    _, service = SERVICES[kind]
    if action == "sent":
        return service.sent(db, kind, "provider-current", lease=lease)
    if action in ("fail", "transient_failure", "permanent_failure"):
        return getattr(service, action)(db, kind, "worker failure", lease=lease)
    return getattr(service, action)(db, kind, lease=lease)


@pytest.mark.parametrize("kind", SERVICES)
def test_recovery_and_new_claim_fence_every_worker_outcome(database, kind):
    model, service = SERVICES[kind]
    with Session(database) as db:
        assert service.mark_dispatched(db, kind)
        assert snapshot(db, model)["attempt_count"] == 0
        service.release_dispatch(db, kind, "broker unavailable")
        assert snapshot(db, model)["attempt_token"] is None
        first = service.claim(db, kind).lease
        db.commit()
    second = takeover(database, kind)
    assert second.token != first.token
    actions = (
        ("sent", "transient_failure", "permanent_failure")
        if kind == "mail"
        else (
            "complete",
            "fail",
            "supersede",
        )
    )
    with Session(database) as db:
        before = snapshot(db, model)
        for stale in (first, replace(second, token=first.token), replace(second, attempt=1)):
            for action in actions:
                assert outcome(db, kind, action, stale) is False
                db.commit()
                assert snapshot(db, model) == before
        assert outcome(db, kind, "sent" if kind == "mail" else "complete", second)
        db.commit()
        after = snapshot(db, model)
        assert after["attempt_token"] is None and after["attempt_count"] == 2
        assert after["status"].value == ("SENT" if kind == "mail" else "COMPLETED")
        if kind == "mail":
            assert after["provider_message_id"] == "provider-current"


@pytest.mark.parametrize("kind", SERVICES)
def test_locked_terminal_mutation_refreshes_preloaded_attempt(database, kind):
    model, service = SERVICES[kind]
    with Session(database) as db:
        first = service.claim(db, kind).lease
        db.commit()
    entered, preloaded = Event(), Event()
    waiter_pid = []

    def stale_worker():
        with Session(database, expire_on_commit=False) as db:
            # Keep a stale ORM object across the winner's commit.
            cached = db.scalars(sa.select(model)).one()
            waiter_pid.append(db.scalar(sa.text("SELECT pg_backend_pid()")))
            preloaded.set()
            assert entered.wait(10)
            accepted = outcome(db, kind, "sent" if kind == "mail" else "complete", first)
            db.commit()
            assert cached.attempt_count == 2
            return accepted

    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(stale_worker)
        assert preloaded.wait(10)
        with Session(database) as winner:
            row = winner.scalars(sa.select(model).with_for_update()).one()
            # Simulate maintenance then a fresh claim while holding the authoritative row.
            row.started_at = utc_now_naive() - timedelta(days=1)
            winner.commit()
            assert kind in service.recover_and_list_due(winner)
            second = service.claim(winner, kind).lease
            winner.flush()
            winner_pid = winner.scalar(sa.text("SELECT pg_backend_pid()"))
            entered.set()
            deadline = monotonic() + 10
            with database.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
                while not observer.scalar(
                    sa.text("SELECT :owner = ANY(pg_blocking_pids(:pid))"),
                    {"owner": winner_pid, "pid": waiter_pid[0]},
                ):
                    assert monotonic() < deadline, "Outcome must wait on the delivery row lock"
                query = observer.scalar(
                    sa.text("SELECT query FROM pg_stat_activity WHERE pid=:pid"),
                    {"pid": waiter_pid[0]},
                )
                assert model.__tablename__ in query and "FOR UPDATE" in query
            winner.commit()
        assert future.result(timeout=10) is False
    with Session(database) as db:
        assert snapshot(db, model)["attempt_token"] == second.token


@pytest.mark.parametrize("kind", ["render", "playback"])
@pytest.mark.parametrize("result", ["complete", "fail", "supersede"])
def test_stale_derivative_worker_cannot_publish_status(database, monkeypatch, kind, result):
    from app.worker.execution import render_outbox, playback_outbox

    module = render_outbox if kind == "render" else playback_outbox

    @contextmanager
    def transaction():
        with Session(database) as db:
            with db.begin():
                yield db

    def generate(*args, **kwargs):
        takeover(database, kind)
        if result == "complete":
            from app.modules.async_operations.durable_delivery import StaleDeliveryAttempt

            raise StaleDeliveryAttempt("Execution lost its lease before adoption")
        if result == "fail":
            raise RuntimeError("render failed")
        if result == "supersede":
            raise RevisionPresentationSuperseded()

    monkeypatch.setattr(module, "SessionLocal", transaction)
    publish = Mock()
    monkeypatch.setattr(module, "publish_score_event", publish)
    if kind == "render":
        monkeypatch.setattr(module, "_render_target", generate)
        execute = module.execute_render_outbox_task
    else:
        monkeypatch.setattr(module.PlaybackGenerationService, "render_for_worker", generate)
        execute = module.execute_playback_outbox_task
    assert execute(None, kind)["status"] == "stale"
    publish.assert_not_called()
    with Session(database) as db:
        row = snapshot(db, SERVICES[kind][0])
        assert row["status"].value == "PROCESSING" and row["attempt_count"] == 2


@pytest.mark.parametrize(
    "model",
    [
        ImportDispatch,
        RenderOutbox,
        PlaybackOutbox,
        MailOutbox,
        ScoreDeletionOperation,
        StoredObjectRetirement,
        ObjectWriteIntent,
    ],
)
def test_processing_token_coherence_is_enforced_by_postgresql(database, model):
    processing = "CLEANUP_PROCESSING" if model is ObjectWriteIntent else "PROCESSING"
    pending = "PREPARED" if model is ObjectWriteIntent else "PENDING"
    with Session(database) as db:
        for status, token in ((processing, None), (pending, "invalid-owner")):
            with pytest.raises(IntegrityError) as failure:
                db.execute(sa.update(model).values(status=status, attempt_token=token))
                db.commit()
            assert failure.value.orig.sqlstate == "23514"
            db.rollback()
        # The write generation's token is independent from cleanup execution ownership.
        if model is ObjectWriteIntent:
            assert db.scalars(sa.select(model)).one().write_token == "generation"
