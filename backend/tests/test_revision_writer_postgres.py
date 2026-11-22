"""Canonical admission, transactional consequences and metadata fencing on real PostgreSQL."""

from app.db.models.revision_metadata_outbox import RevisionMetadataOutboxStatus

from app.modules.import_jobs.requested_options import encode_requested_options

from tests.support.storage_state import provision_storage_users

from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import replace
from datetime import timedelta
from hashlib import sha256
from threading import Event, Barrier
from time import monotonic
from uuid import uuid4
import pytest
import sqlalchemy as sa
from sqlalchemy.orm import Session
from alembic import command
from app.db.models import (
    User,
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    ScoreRevisionMetadata,
    ScoreRevisionEvent,
    ImportJob,
    ImportDispatch,
    ImportDispatchStatus,
    StorageUsageCategory,
    StorageUsageReservation,
    StorageUsageEvent,
    StorageUsageAccount,
    StorageUsageCounter,
    StoredObject,
    ObjectWriteIntent,
    ScoreRevisionRenderOutbox,
    PlaybackOutbox,
    ScoreMembership,
    MembershipRole,
    Notification,
    RealtimeChange,
    RevisionMetadataOutbox,
)
from app.db.models.import_job import ImportJobState
from app.db.models.score import RevisionOrigin, MetadataStatus
from app.modules.revisions import writer as writer_module
from app.modules.revisions.writer import (
    revision_writer,
    PreparedRevisionSource,
    InitialRevisionWrite,
    AppendRevisionWrite,
    RestoreLineage,
)
from app.modules.revisions.metadata_delivery import (
    metadata_delivery,
    compute_metadata,
    MetadataResult,
)
from app.modules.storage_usage.service import storage_usage_service
from app.modules.storage_objects.writes import write_object
from app.core.exceptions import ConflictException
from app.modules.durable_work.delivery import StaleDeliveryAttempt
from app.processing.musicxml.admission import admit_musicxml_document
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database
from tests.support.object_storage import InMemoryObjectStorage
from tests.support.write_cleanup import drain_write_cleanup
from tests.test_score_revision_services import MUSICXML_1, MUSICXML_2


@pytest.fixture
def database(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        with Session(engine) as db:
            db.add_all(
                [
                    User(
                        id=i,
                        email=f"writer{i}@example.test",
                        display_name=f"User {i}",
                        password_hash="hash",
                    )
                    for i in (1, 2, 3)
                ]
            )
            db.flush()
            db.add(
                ImportJob(
                    requested_options=encode_requested_options(None),
                    processing_started_at=utc_now(),
                    processing_finished_at=utc_now(),
                    id=1,
                    job_uuid="job",
                    user_id=1,
                    state=ImportJobState.READY_FOR_REVIEW,
                )
            )
            db.flush()
            db.add_all(
                [
                    Score(score_uuid="score", owner_user_id=1, display_title="Etudes"),
                    ImportDispatch(job_id=1, status=ImportDispatchStatus.COMPLETED),
                ]
            )
            db.flush()
            provision_storage_users(db)
            db.commit()
        yield engine, InMemoryObjectStorage()


def prepare(engine, storage, content=MUSICXML_1):
    content = admit_musicxml_document(content.encode() if isinstance(content, str) else content)
    uuid = str(uuid4())
    with Session(engine) as db:
        reservation = storage_usage_service.reserve(
            db,
            user_id=1,
            category=StorageUsageCategory.SOURCE,
            bytes_count=len(content),
            reason="revision_write",
            object_type="score_revision_source",
        )
        db.commit()
        receipt = write_object(
            db,
            storage,
            key=f"scores/score/revisions/{uuid}/score.musicxml",
            content=content,
            content_type="application/vnd.recordare.musicxml+xml",
        )
    return PreparedRevisionSource(
        uuid, receipt, sha256(content).hexdigest(), "test", "1", reservation.reservation_id
    )


def initial(database):
    engine, storage = database
    source = prepare(engine, storage)
    with Session(engine) as db:
        result = revision_writer.write(db, InitialRevisionWrite("score", 1, source, "initial"))
        db.commit()
        return result.revision.revision_uuid


def snapshot(db):
    models = (
        Score,
        ScoreRevision,
        ScoreRevisionSource,
        ScoreRevisionMetadata,
        ScoreRevisionEvent,
        ScoreRevisionRenderOutbox,
        PlaybackOutbox,
        RevisionMetadataOutbox,
        Notification,
        RealtimeChange,
        StoredObject,
        StorageUsageEvent,
        StorageUsageAccount,
        StorageUsageCounter,
    )
    return {
        m.__tablename__: [dict(r) for r in db.execute(sa.select(m.__table__)).mappings()]
        for m in models
    }


@pytest.mark.parametrize("same_key", [False, True])
def test_concurrent_head_writes_serialize_and_idempotency_resolves_in_writer(database, same_key):
    engine, storage = database
    head = initial(database)
    first = prepare(engine, storage, MUSICXML_2)
    second = prepare(engine, storage, MUSICXML_2 if same_key else MUSICXML_2.replace("D", "E"))
    cmd1 = AppendRevisionWrite(
        "score", 1, first, head, RevisionOrigin.EDIT, "append" if same_key else "first"
    )
    cmd2 = AppendRevisionWrite(
        "score", 1, second, head, RevisionOrigin.EDIT, "append" if same_key else "second"
    )
    waiting, pid = Event(), []

    def competitor():
        with Session(engine) as db:
            pid.append(db.scalar(sa.text("SELECT pg_backend_pid()")))
            waiting.set()
            try:
                result = revision_writer.write(db, cmd2)
                db.commit()
                return result.post_commit_work is not None, result.revision.revision_uuid
            except ConflictException as exc:
                db.rollback()
                return exc.code

    with ThreadPoolExecutor(max_workers=1) as pool:
        with Session(engine) as winner:
            result = revision_writer.write(winner, cmd1)
            owner = winner.scalar(sa.text("SELECT pg_backend_pid()"))
            future = pool.submit(competitor)
            assert waiting.wait(10)
            deadline = monotonic() + 10
            with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
                while not observer.scalar(
                    sa.text("SELECT :owner=ANY(pg_blocking_pids(:pid))"),
                    {"owner": owner, "pid": pid[0]},
                ):
                    assert monotonic() < deadline
                assert "scores" in observer.scalar(
                    sa.text("SELECT query FROM pg_stat_activity WHERE pid=:pid"), {"pid": pid[0]}
                )
            winner.commit()
            created_uuid = result.revision.revision_uuid
        assert future.result(10) == ((False, created_uuid) if same_key else "revision_conflict")
    with Session(engine) as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(ScoreRevision)) == 2
        for model in (
            ScoreRevisionSource,
            ScoreRevisionMetadata,
            ScoreRevisionRenderOutbox,
            PlaybackOutbox,
            RevisionMetadataOutbox,
        ):
            assert db.scalar(sa.select(sa.func.count()).select_from(model)) == 2
        assert db.scalar(sa.select(Notification)) is None
        assert db.scalar(sa.select(sa.func.count()).select_from(RealtimeChange)) == 1
        score = db.scalar(sa.select(Score))
        assert (
            score.metadata_version == 1
            and db.get(ScoreRevision, score.head_revision_id).revision_number == 2
        )
        if not same_key:
            storage_usage_service.release_reservation(db, second.reservation_id)
            db.commit()
        assert all(item["status"] == "cleaned" for item in drain_write_cleanup(db, storage))


@pytest.mark.parametrize("failure", ["adopt", "reservation", "notification", "realtime", "notify"])
def test_writer_outer_rollback_keeps_prewrite_cleanup_owned_and_reservation_releasable(
    database, monkeypatch, failure
):
    engine, storage = database
    head = initial(database)
    source = prepare(engine, storage, MUSICXML_2)
    from app.modules.realtime import publisher

    with Session(engine) as db:
        score = db.scalar(sa.select(Score))
        db.add(
            ScoreMembership(
                score_id=score.id, user_id=2, role=MembershipRole.EDITOR, created_by_user_id=1
            )
        )
        db.commit()
    target, method = {
        "adopt": (writer_module, "adopt_written_object"),
        "reservation": (storage_usage_service, "commit_reservation"),
        "notification": (writer_module.notification_service, "admit_score_version_created"),
        "realtime": (writer_module, "publish_change"),
        "notify": (publisher, "_notify_change"),
    }[failure]
    original = getattr(target, method)

    def abort(*args, **kwargs):
        result = original(*args, **kwargs)
        if failure == "notification" and result is None:
            return result
        if failure == "realtime" and kwargs["recipient_user_id"] == 1:
            return result
        if failure == "notify" and args[1].recipient_user_id == 1:
            return result
        raise RuntimeError("abort semantic transaction")

    monkeypatch.setattr(target, method, abort)
    with Session(engine) as db:
        before = snapshot(db)
        with pytest.raises(RuntimeError, match="semantic transaction"):
            revision_writer.write(
                db, AppendRevisionWrite("score", 1, source, head, RevisionOrigin.EDIT)
            )
        db.rollback()
        assert snapshot(db) == before
        reservation = db.scalar(
            sa.select(StorageUsageReservation).where(
                StorageUsageReservation.reservation_uuid == source.reservation_id
            )
        )
        assert reservation.status.value == "RESERVED"
        storage_usage_service.release_reservation(db, source.reservation_id)
        db.commit()
        assert (
            db.get(
                ObjectWriteIntent,
                db.scalar(
                    sa.select(ObjectWriteIntent.id).where(
                        ObjectWriteIntent.intent_uuid == source.receipt.intent_uuid
                    )
                ),
            ).status
            == "WRITTEN"
        )
        assert drain_write_cleanup(db, storage)[0]["status"] == "cleaned"


def test_initial_append_restore_noop_and_history_are_one_boundary(database):
    engine, storage = database
    head = initial(database)
    noop = prepare(engine, storage)
    with Session(engine) as db:
        before = snapshot(db)
        assert (
            revision_writer.write(
                db, AppendRevisionWrite("score", 1, noop, head, RevisionOrigin.EDIT)
            ).post_commit_work
            is None
        )
        db.commit()
        after = snapshot(db)
        for name in before.keys() - {"storage_usage_accounts", "storage_usage_counters"}:
            assert after[name] == before[name]
        assert db.scalar(sa.select(StorageUsageAccount)).reserved_bytes == 0
        assert (
            db.scalar(sa.select(StorageUsageAccount)).used_bytes
            == before["storage_usage_accounts"][0]["used_bytes"]
        )
    source = prepare(engine, storage, MUSICXML_2)
    with Session(engine) as db:
        appended = revision_writer.write(
            db, AppendRevisionWrite("score", 1, source, head, RevisionOrigin.EDIT)
        )
        db.commit()
        current = appended.revision.revision_uuid
    restored = prepare(engine, storage)
    with Session(engine) as db:
        result = revision_writer.write(
            db,
            AppendRevisionWrite(
                "score",
                1,
                restored,
                current,
                RevisionOrigin.EDIT,
                restore=RestoreLineage(head, "  restored  "),
            ),
        )
        db.commit()
        assert db.scalar(sa.select(ScoreRevisionEvent)).target_revision_id == db.scalar(
            sa.select(ScoreRevision.id).where(ScoreRevision.revision_uuid == head)
        )
        assert db.scalar(sa.select(ScoreRevisionEvent)).note == "restored"
        assert result.revision.revision_number == 3


def test_revision_consequences_keep_the_transaction_audience(database):
    engine, storage = database
    head = initial(database)
    with Session(engine) as db:
        score = db.scalar(sa.select(Score))
        db.add(
            ScoreMembership(
                score_id=score.id, user_id=2, role=MembershipRole.EDITOR, created_by_user_id=1
            )
        )
        db.commit()
    source = prepare(engine, storage, MUSICXML_2)
    with Session(engine) as db:
        result = revision_writer.write(
            db, AppendRevisionWrite("score", 1, source, head, RevisionOrigin.EDIT)
        )
        with Session(engine) as observer:
            assert observer.scalar(sa.select(sa.func.count()).select_from(ScoreRevision)) == 1
            assert observer.scalar(sa.select(Notification)) is None
            assert observer.scalar(sa.select(RealtimeChange)) is None
        db.commit()
        for model in (
            ScoreRevision,
            ScoreRevisionSource,
            ScoreRevisionMetadata,
            ScoreRevisionRenderOutbox,
            PlaybackOutbox,
            RevisionMetadataOutbox,
        ):
            assert db.scalar(sa.select(sa.func.count()).select_from(model)) == 2
        notice = db.scalar(sa.select(Notification))
        assert notice.created_at == result.revision.created_at
        assert notice.revision_id == result.revision.revision_uuid
        assert notice.score_display_title_snapshot == "Etudes"
        assert db.scalar(sa.select(StorageUsageAccount)).reserved_bytes == 0
        member = db.scalar(sa.select(ScoreMembership))
        member.revoked_at = utc_now()
        db.add(
            ScoreMembership(
                score_id=member.score_id,
                user_id=3,
                role=MembershipRole.VIEWER,
                created_by_user_id=1,
            )
        )
        db.commit()

        notifications = list(db.scalars(sa.select(Notification)))
        assert len(notifications) == 1 and notifications[0].recipient_user_id == 2
        realtime = list(db.scalars(sa.select(RealtimeChange)))
        assert sorted(
            r.recipient_user_id for r in realtime if r.kind == "score.revisions.changed"
        ) == [1, 2]
        assert len([r for r in realtime if r.kind == "notifications.changed"]) == 1


@pytest.mark.parametrize("outcome", ["ready", "semantic_failure"])
def test_metadata_mid_compute_takeover_and_atomic_completion(database, monkeypatch, outcome):
    engine, storage = database
    initial(database)
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
    computed, release = Event(), Event()
    original = worker.compute_metadata

    def pause(content):
        result = original(content)
        computed.set()
        assert release.wait(15)
        return result

    monkeypatch.setattr(worker, "compute_metadata", pause)
    with Session(engine) as db:
        uuid = db.scalar(sa.select(RevisionMetadataOutbox.outbox_uuid))
    with ThreadPoolExecutor(max_workers=1) as pool:
        future = pool.submit(worker.execute_revision_metadata_task, None, uuid)
        try:
            assert computed.wait(15)
            with Session(engine) as db:
                row = db.scalar(sa.select(RevisionMetadataOutbox))
                token = row.attempt_token
                row.started_at = utc_now() - timedelta(days=1)
                db.commit()
                assert metadata_delivery.recover_and_list_due(db) == [uuid]
                second = metadata_delivery.claim(db, uuid)
                db.commit()
                assert second.lease.token != token
        finally:
            release.set()
        assert future.result(15)["status"] == "stale"
    result = (
        compute_metadata(storage.read_bytes(second.source.storage_key))
        if outcome == "ready"
        else MetadataResult(None, "unsupported_metadata")
    )
    with Session(engine) as db:
        assert db.scalar(sa.select(ScoreRevisionMetadata)).status == MetadataStatus.PENDING
        assert db.scalar(sa.select(RealtimeChange)) is None
        metadata_delivery.adopt(db, second, result)
        db.flush()
        db.rollback()
        assert db.scalar(sa.select(ScoreRevisionMetadata)).status == MetadataStatus.PENDING
        assert db.scalar(sa.select(RevisionMetadataOutbox)).attempt_token == second.lease.token
        assert db.scalar(sa.select(RealtimeChange)) is None
        metadata_delivery.adopt(db, second, result)
        db.commit()
        assert (
            db.scalar(sa.select(RevisionMetadataOutbox)).status
            is RevisionMetadataOutboxStatus.COMPLETED
        )
        assert db.scalar(sa.select(ScoreRevisionMetadata)).status == (
            MetadataStatus.READY if outcome == "ready" else MetadataStatus.FAILED
        )
        assert db.scalar(sa.select(RealtimeChange)).kind == "score.metadata.changed"


def test_review_confirm_concurrency_uses_one_initial_revision(database, monkeypatch):
    engine, storage = database
    with Session(engine) as db:
        before = set(db.scalars(sa.select(RealtimeChange.change_uuid)))
    from app.modules.import_jobs.review import service as review_module
    from app.modules.import_jobs.review.schemas import ReviewConfirmRequest

    barrier = Barrier(2)
    write = review_module.write_object

    def paused(*args, **kwargs):
        receipt = write(*args, **kwargs)
        barrier.wait(15)
        return receipt

    def latency_only(*args):
        pass

    monkeypatch.setattr(review_module, "write_object", paused)
    monkeypatch.setattr(review_module.revision_post_commit, "dispatch_best_effort", latency_only)

    def confirm():
        with Session(engine) as db:
            return (
                review_module.ImportReviewService(storage=storage)
                .confirm(db, "job", 1, ReviewConfirmRequest(content=MUSICXML_2))
                .score_id
            )

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: confirm(), range(2)))
    assert results[0] == results[1]
    with Session(engine) as db:
        assert db.scalar(sa.select(sa.func.count()).select_from(ScoreRevision)) == 1
        assert db.scalar(sa.select(Notification)) is None
        changes = list(db.scalars(sa.select(RealtimeChange)))
        assert len(changes) == len(before) + 1
        delta = [change for change in changes if change.change_uuid not in before]
        assert len(delta) == 1
        change = delta[0]
        assert (
            change.recipient_user_id,
            change.kind,
            change.import_job_id,
            change.notification_id,
            change.sequence,
        ) == (1, "import_jobs.changed", "job", None, 1)
        for model in (ScoreRevisionRenderOutbox, PlaybackOutbox, RevisionMetadataOutbox):
            assert db.scalar(sa.select(sa.func.count()).select_from(model)) == 1


def test_metadata_relay_releases_broker_failure_without_consuming_attempt_and_beat_recovers(
    database, monkeypatch
):
    engine, storage = database
    initial(database)
    from app.modules.revisions import metadata_dispatch
    from app.worker.execution import revision_metadata as worker
    from app.task_queue import producer
    from app.worker import task_runtime

    @contextmanager
    def transaction():
        with Session(engine) as db:
            try:
                yield db
                db.commit()
            except Exception:
                db.rollback()
                raise

    monkeypatch.setattr(metadata_dispatch, "SessionLocal", transaction)
    monkeypatch.setattr(worker, "SessionLocal", transaction)
    monkeypatch.setattr(task_runtime, "SessionLocal", transaction)
    with Session(engine) as db:
        uuid = db.scalar(sa.select(RevisionMetadataOutbox.outbox_uuid))

    def reject(*args, **kwargs):
        raise ConnectionError("broker unavailable")

    monkeypatch.setattr(producer.celery_app, "send_task", reject)
    assert not metadata_dispatch.dispatch_revision_metadata(uuid)
    with Session(engine) as db:
        row = db.scalar(sa.select(RevisionMetadataOutbox))
        assert (
            row.status is RevisionMetadataOutboxStatus.PENDING
            and row.attempt_count == 0
            and row.attempt_token is None
        )
    sent = []
    monkeypatch.setattr(
        producer.celery_app, "send_task", lambda name, **kwargs: sent.append((name, kwargs))
    )
    assert worker.execute_revision_metadata_maintenance()["dispatched"] == 1
    assert sent[0][0] == "app.worker.tasks.revision_metadata_task"
    monkeypatch.setattr(worker, "object_storage", storage)
    assert worker.execute_revision_metadata_task(None, uuid)["status"] == "completed"


def test_metadata_database_token_coherence_and_source_failure_are_delivery_semantics(
    database, monkeypatch
):
    engine, storage = database
    initial(database)
    from sqlalchemy.exc import IntegrityError

    with Session(engine) as db:
        for status, token in (("PROCESSING", None), ("PENDING", "invalid-owner")):
            with pytest.raises(IntegrityError):
                db.execute(
                    sa.update(RevisionMetadataOutbox).values(status=status, attempt_token=token)
                )
                db.commit()
            db.rollback()
        uuid = db.scalar(sa.select(RevisionMetadataOutbox.outbox_uuid))
        payload = metadata_delivery.claim(db, uuid)
        db.commit()
        assert metadata_delivery.fail(db, uuid, payload.lease, "OSError")
        db.commit()
        assert db.scalar(sa.select(ScoreRevisionMetadata)).status == MetadataStatus.PENDING
        assert (
            db.scalar(sa.select(RevisionMetadataOutbox)).status
            is RevisionMetadataOutboxStatus.FAILED
        )
        with pytest.raises(StaleDeliveryAttempt):
            metadata_delivery.adopt(
                db, payload, compute_metadata(storage.read_bytes(payload.source.storage_key))
            )
        db.rollback()
        assert db.scalar(sa.select(RealtimeChange)) is None


@pytest.mark.parametrize("invalid", ["hash", "mime", "resource", "reservation"])
def test_prepared_source_admission_is_fail_closed(database, invalid):
    engine, storage = database
    source = prepare(engine, storage)
    if invalid == "hash":
        source = replace(source, content_hash="c" * 64)
    elif invalid == "mime":
        source = replace(
            source,
            receipt=replace(
                source.receipt, facts=replace(source.receipt.facts, content_type="text/plain")
            ),
        )
    elif invalid == "resource":
        source = replace(source, revision_uuid=str(uuid4()))
    else:
        source = replace(source, reservation_id="absent-reservation")
    with Session(engine) as db:
        before = snapshot(db)
        with pytest.raises(ValueError):
            revision_writer.write(db, InitialRevisionWrite("score", 1, source, "initial"))
        db.rollback()
        assert snapshot(db) == before


@pytest.mark.parametrize("failure", ["read", "fingerprint"])
def test_metadata_worker_retries_source_failures_without_metadata_or_realtime_mutation(
    database, monkeypatch, failure
):
    engine, storage = database
    initial(database)
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

    def read(key):
        if failure == "read":
            raise OSError("source temporarily unavailable")
        return b"unexpected physical content"

    monkeypatch.setattr(worker, "SessionLocal", transaction)
    monkeypatch.setattr(worker, "object_storage", storage)
    monkeypatch.setattr(storage, "read_bytes", read)
    with Session(engine) as db:
        uuid = db.scalar(sa.select(RevisionMetadataOutbox.outbox_uuid))
    assert worker.execute_revision_metadata_task(None, uuid)["status"] == "failed"
    with Session(engine) as db:
        row = db.scalar(sa.select(RevisionMetadataOutbox))
        assert (
            row.status is RevisionMetadataOutboxStatus.FAILED
            and row.attempt_count == 1
            and row.attempt_token is None
        )
        assert row.next_attempt_at > row.started_at
        assert db.scalar(sa.select(ScoreRevisionMetadata)).status == MetadataStatus.PENDING
        assert db.scalar(sa.select(RealtimeChange)) is None


def test_writer_rejects_a_receipt_outside_the_canonical_revision_identity(database):
    engine, storage = database
    source = prepare(engine, storage)
    with Session(engine) as db:
        wrong = write_object(
            db,
            storage,
            key="other/source.musicxml",
            content=storage.read_bytes(source.receipt.object_key),
            content_type=source.receipt.facts.content_type,
        )
        with pytest.raises(ValueError, match="canonical source identity"):
            revision_writer.write(
                db,
                InitialRevisionWrite("score", 1, replace(source, receipt=wrong), "wrong-source"),
            )
        db.rollback()
        assert db.scalar(sa.select(ScoreRevisionSource)) is None
        assert db.scalar(sa.select(ScoreRevision)) is None
