"""Partial recipient inserts/NOTIFY must not escape authoritative outcome rollback."""

from contextlib import contextmanager
from datetime import timedelta
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from app.db.models import (
    User,
    Score,
    ScoreMembership,
    MembershipRole,
    RealtimeChange,
    ScoreRevisionMetadata,
    RevisionMetadataOutbox,
    ObjectWriteIntent,
)
from app.db.models.score import MetadataStatus
from app.modules.realtime import publisher
from app.modules.revisions.metadata_delivery import (
    metadata_delivery,
    compute_metadata,
    MetadataResult,
)
from app.modules.durable_work.delivery import StaleDeliveryAttempt
from app.utils.timezone import utc_now_naive
from tests.test_revision_writer_postgres import database as database, initial
from tests.test_derivative_adoption_postgres import generation as generation, semantic_snapshot
from tests.support.write_cleanup import drain_write_cleanup


def add_member(engine):
    with Session(engine) as db:
        if db.get(User, 2) is None:
            db.add(User(id=2, email="participant@example.test", password_hash="hash"))
            db.flush()
        score = db.scalar(sa.select(Score))
        db.add(
            ScoreMembership(
                score_id=score.id,
                user_id=2,
                role=MembershipRole.EDITOR,
                created_by_user_id=score.owner_user_id,
            )
        )
        db.commit()


def interrupt_second_notify(monkeypatch, *, first_outcome_only=False):
    original = publisher._notify_change
    recipients = []

    def notify(db, event):
        original(db, event)  # Real PostgreSQL pg_notify participates in the transaction.
        if not first_outcome_only or len(recipients) < 2:
            recipients.append(event.recipient_user_id)
            if len(recipients) == 2:
                assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) >= 2
                raise RuntimeError("partial realtime fan-out interrupted")

    monkeypatch.setattr(publisher, "_notify_change", notify)
    return original, recipients


@pytest.mark.parametrize("semantic_failure", [False, True])
def test_metadata_partial_publication_rolls_back_and_retry_is_authoritative(
    database, monkeypatch, semantic_failure
):
    engine, storage = database
    initial(database)
    add_member(engine)
    with Session(engine) as db:
        uuid = db.scalar(sa.select(RevisionMetadataOutbox.outbox_uuid))
        first = metadata_delivery.claim(db, uuid)
        db.commit()
    result = (
        MetadataResult(None, "unsupported_nontraditional_key")
        if semantic_failure
        else compute_metadata(storage.read_bytes(first.source_key))
    )
    original, recipients = interrupt_second_notify(monkeypatch)
    with Session(engine) as db:
        with pytest.raises(RuntimeError, match="fan-out interrupted"):
            metadata_delivery.adopt(db, first, result)
        db.rollback()
        assert recipients == [1, 2]
        assert db.scalar(sa.select(ScoreRevisionMetadata)).status == MetadataStatus.PENDING
        row = db.scalar(sa.select(RevisionMetadataOutbox))
        assert row.status == "PROCESSING" and row.attempt_token == first.lease.token
        assert row.attempt_count == first.lease.attempt
        assert db.scalar(sa.select(RealtimeChange)) is None
    with Session(engine) as db:
        assert metadata_delivery.fail(db, uuid, first.lease, "realtime publication unavailable")
        db.commit()
        row = db.scalar(sa.select(RevisionMetadataOutbox))
        row.next_attempt_at = utc_now_naive() - timedelta(seconds=1)
        db.commit()
        second = metadata_delivery.claim(db, uuid)
        db.commit()
        assert second.lease.attempt == 2 and second.lease.token != first.lease.token
        with pytest.raises(StaleDeliveryAttempt):
            metadata_delivery.adopt(db, first, result)
        db.rollback()
        monkeypatch.setattr(publisher, "_notify_change", original)
        metadata_delivery.adopt(db, second, result)
        db.commit()
        assert db.scalar(sa.select(ScoreRevisionMetadata)).status == (
            MetadataStatus.FAILED if semantic_failure else MetadataStatus.READY
        )
        assert db.scalar(sa.select(RevisionMetadataOutbox)).status == "COMPLETED"
        events = list(db.scalars(sa.select(RealtimeChange)))
        assert len(events) == 2 and sorted(event.recipient_user_id for event in events) == [1, 2]
        assert all(event.kind == "score.metadata.changed" for event in events)


@pytest.mark.parametrize("generation", ["render", "playback"], indirect=True)
@pytest.mark.parametrize("replace_existing", [False, True])
def test_derivative_ready_publication_failure_rolls_back_adoption_and_fails_exact_attempt(
    generation, monkeypatch, replace_existing
):
    kind, engine, storage, service, model, module, lifecycle, execute, generate = generation
    add_member(engine)
    if replace_existing:
        assert execute(None, "delivery")["status"] in ("rendered", "generated")
        with Session(engine) as db:
            lifecycle().rearm(db.scalar(sa.select(model)), now=utc_now_naive())
            db.commit()
    with Session(engine) as db:
        before = semantic_snapshot(db)
    _, recipients = interrupt_second_notify(monkeypatch, first_outcome_only=True)
    assert execute(None, "delivery")["status"] == "failed"
    with Session(engine) as db:
        assert recipients == [1, 2]
        after = semantic_snapshot(db)
        for name in before.keys() - {"realtime_changes"}:
            assert after[name] == before[name]
        old_ids = {event["sequence"] for event in before["realtime_changes"]}
        new_events = [
            event for event in after["realtime_changes"] if event["sequence"] not in old_ids
        ]
        assert len(new_events) == 2 and all(
            event["kind"] == "score.derived_assets.changed" for event in new_events
        )
        row = db.scalar(sa.select(model))
        assert (
            row.status.value == "FAILED" and row.attempt_token is None and row.completed_at is None
        )
        unadopted = db.scalar(
            sa.select(ObjectWriteIntent).where(ObjectWriteIntent.status == "WRITTEN")
        )
        assert unadopted is not None and storage.exists(unadopted.object_key)
        key = unadopted.object_key
        assert drain_write_cleanup(db, storage)[0]["status"] == "cleaned"
        assert not storage.exists(key)


@pytest.mark.parametrize("generation", ["render", "playback"], indirect=True)
def test_failed_outcome_publication_failure_leaves_processing_for_lease_recovery(
    generation, monkeypatch
):
    kind, engine, storage, service, model, module, lifecycle, execute, generate = generation
    add_member(engine)
    from app.worker.execution import render_outbox, playback_outbox

    def fail(*args, **kwargs):
        raise OSError("generation failed")

    if kind == "render":
        monkeypatch.setattr(render_outbox, "_render_target", fail)
    else:
        monkeypatch.setattr(playback_outbox.PlaybackGenerationService(), "render_for_worker", fail)
    original, recipients = interrupt_second_notify(monkeypatch, first_outcome_only=True)
    with pytest.raises(RuntimeError, match="fan-out interrupted"):
        execute(None, "delivery")
    with Session(engine) as db:
        row = db.scalar(sa.select(model))
        assert recipients == [1, 2]
        assert row.status.value == "PROCESSING" and row.attempt_token is not None
        assert row.last_error is None and db.scalar(sa.select(RealtimeChange)) is None
        token = row.attempt_token
        row.started_at = utc_now_naive() - timedelta(days=1)
        db.commit()
        assert service.recover_and_list_due(db) == ["delivery"]
        db.commit()
        second = service.claim(db, "delivery")
        db.commit()
        assert second.lease.token != token and second.lease.attempt == 2
        monkeypatch.setattr(publisher, "_notify_change", original)
        assert service.fail(db, "delivery", "current failure", lease=second.lease)
        publisher.publish_score_change(
            db,
            score_id=second.score_uuid,
            revision_id=second.revision_uuid,
            kind=publisher.RealtimeChangeKind.SCORE_DERIVED_ASSETS_CHANGED,
        )
        db.commit()
        assert db.scalar(sa.select(model)).status.value == "FAILED"
        assert len(list(db.scalars(sa.select(RealtimeChange)))) == 2


def test_metadata_worker_retries_publication_infrastructure_failure(database, monkeypatch):
    engine, storage = database
    initial(database)
    add_member(engine)
    from app.worker.execution import revision_metadata as worker

    @contextmanager
    def transaction():
        with Session(engine) as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    monkeypatch.setattr(worker, "SessionLocal", transaction)
    monkeypatch.setattr(worker, "object_storage", storage)
    original, _ = interrupt_second_notify(monkeypatch)
    failure = metadata_delivery.fail

    def fail_after_rollback(db, uuid, lease, error):
        row = db.scalar(sa.select(RevisionMetadataOutbox))
        assert row.status == "PROCESSING" and row.attempt_token == lease.token
        assert db.scalar(sa.select(ScoreRevisionMetadata)).status == MetadataStatus.PENDING
        assert db.scalar(sa.select(RealtimeChange)) is None
        return failure(db, uuid, lease, error)

    monkeypatch.setattr(metadata_delivery, "fail", fail_after_rollback)
    with Session(engine) as db:
        uuid = db.scalar(sa.select(RevisionMetadataOutbox.outbox_uuid))
    assert worker.execute_revision_metadata_task(None, uuid)["status"] == "failed"
    with Session(engine) as db:
        row = db.scalar(sa.select(RevisionMetadataOutbox))
        assert row.status == "FAILED" and row.attempt_token is None
        row.next_attempt_at = utc_now_naive() - timedelta(seconds=1)
        db.commit()
    monkeypatch.setattr(publisher, "_notify_change", original)
    assert worker.execute_revision_metadata_task(None, uuid)["status"] == "completed"
    with Session(engine) as db:
        assert db.scalar(sa.select(RevisionMetadataOutbox)).attempt_count == 2
        assert len(list(db.scalars(sa.select(RealtimeChange)))) == 2
