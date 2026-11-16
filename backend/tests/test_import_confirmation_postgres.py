"""Import confirmation commits provenance, revision admission, notification enrichment and release together."""

from concurrent.futures import ThreadPoolExecutor
from queue import Queue
from threading import Event, Barrier
from time import monotonic

import pytest
import sqlalchemy as sa
from alembic import command
from sqlalchemy.orm import Session

from app.db.models import (
    User,
    ImportJob,
    ImportDispatch,
    ImportDispatchStatus,
    ImportArtifact,
    ImportJobUpload,
    Upload,
    StoredObject,
    StoredObjectRetirement,
    Score,
    ScoreRevision,
    ScoreRevisionSource,
    ScoreRevisionMetadata,
    RenderOutbox,
    PlaybackOutbox,
    RevisionMetadataOutbox,
    ScoreInputAsset,
    StorageUsageCategory,
    StorageUsageCounter,
    StorageUsageEvent,
    ObjectWriteIntent,
    Notification,
    RealtimeChange,
    RealtimeStreamState,
)
from app.db.models.import_job import ImportJobState
from app.modules.import_jobs.review import service as review
from app.modules.import_jobs.review.schemas import ReviewConfirmRequest
from app.modules.import_jobs.service import ImportJobService
from app.modules.import_jobs.notifications import admit_import_processing_outcome
from app.modules.storage_objects.persistence import object_from_bytes
from app.modules.storage_usage.service import storage_usage_service
from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.shared.time import utc_now
from tests.support.postgres_schema import postgres_schema_database
from tests.support.object_storage import InMemoryObjectStorage
from tests.support.write_cleanup import drain_write_cleanup
from tests.test_score_revision_services import MUSICXML_1


@pytest.fixture
def confirmation(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        storage = InMemoryObjectStorage()
        with Session(engine) as db:
            db.add(User(id=1, email="confirm@example.test", password_hash="hash"))
            db.flush()
            job = ImportJob(
                processing_started_at=utc_now(),
                processing_finished_at=utc_now(),
                job_uuid="job",
                user_id=1,
                state=ImportJobState.READY_FOR_REVIEW,
                requested_options={"display_title": "Etudes"},
            )
            db.add(job)
            db.flush()
            db.add(ImportDispatch(job_id=job.id, status=ImportDispatchStatus.COMPLETED))
            for kind, content in (
                ("review_musicxml", MUSICXML_1),
                ("review_preview_image", b"<svg/>"),
            ):
                obj = object_from_bytes(
                    object_key=f"jobs/{kind}",
                    content=content,
                    content_type="image/svg+xml" if "image" in kind else "application/xml",
                )
                db.add(obj)
                db.flush()
                storage.put_bytes(
                    key=obj.object_key, content=content, content_type=obj.content_type
                )
                db.add(
                    ImportArtifact(
                        job_id=job.id,
                        artifact_uuid=kind,
                        kind=kind,
                        stored_object_id=obj.id,
                        filename=kind + ".svg",
                    )
                )
                storage_usage_service.record_allocation(
                    db,
                    user_id=1,
                    category=StorageUsageCategory.TEMP_IMPORT,
                    bytes_count=len(content),
                    reason="fixture",
                    object_type="import_artifact",
                )
            obj = object_from_bytes(
                object_key="uploads/page", content=b"original", content_type="image/png"
            )
            db.add(obj)
            db.flush()
            upload = Upload(
                uploader_user_id=1, stored_object_id=obj.id, original_filename="page.png"
            )
            db.add(upload)
            db.flush()
            db.add(ImportJobUpload(job_id=job.id, upload_id=upload.id, page_number=1, sort_order=1))
            storage_usage_service.record_allocation(
                db,
                user_id=1,
                category=StorageUsageCategory.UPLOAD,
                bytes_count=8,
                reason="fixture",
                object_type="upload",
            )
            admit_import_processing_outcome(db, job, created_at=utc_now())
            db.commit()

        def latency_only(*args):
            pass

        monkeypatch.setattr(review, "revision_fast_path", latency_only)
        yield engine, storage


def confirm(engine, storage):
    with Session(engine, expire_on_commit=False) as db:
        return (
            review.ImportReviewService(storage=storage)
            .confirm(db, "job", 1, ReviewConfirmRequest(content=MUSICXML_1.decode()))
            .score_id
        )


@pytest.mark.parametrize(
    "explicit,submitted,notation,expected",
    [
        ("Review name", "Submitted name", "Notation", "Review name"),
        (None, "Submitted name", "Notation", "Submitted name"),
        (None, None, "  Moonlight Sonata  ", "Moonlight Sonata"),
        (None, None, None, "Untitled score"),
    ],
)
def test_confirmation_initializes_display_title_from_explicit_precedence(
    confirmation,
    explicit,
    submitted,
    notation,
    expected,
):
    from tests.support.revision_metadata import drain_revision_metadata

    engine, storage = confirmation
    content = MUSICXML_1.decode()
    if notation is not None:
        content = content.replace(
            "<part-list>", f"<work><work-title>{notation}</work-title></work><part-list>"
        )
    with Session(engine) as db:
        job = db.scalar(sa.select(ImportJob))
        job.requested_options = {"display_title": submitted} if submitted is not None else {}
        db.commit()
        processing_finished_at = job.processing_finished_at
        processing_started_at = job.processing_started_at
        result = review.ImportReviewService(storage=storage).confirm(
            db,
            "job",
            1,
            ReviewConfirmRequest(content=content, display_title=explicit),
        )
        confirmed_at = job.confirmed_at
        assert confirmed_at is not None
        assert job.processing_started_at == processing_started_at
        assert job.processing_finished_at == processing_finished_at
        repeated = review.ImportReviewService(storage=storage).confirm(
            db, "job", 1, ReviewConfirmRequest(content=content, display_title=explicit)
        )
        assert repeated.score_id == result.score_id and job.confirmed_at == confirmed_at
        drain_revision_metadata(db, storage)
        score = db.scalar(sa.select(Score).where(Score.score_uuid == result.score_id))
        assert score.display_title == expected
        metadata = db.get(ScoreRevisionMetadata, score.head_revision_id)
        assert metadata.notation_title == (notation.strip() if notation else None)


def test_display_title_and_revision_notation_title_have_independent_lifecycles(confirmation):
    from app.modules.revisions.service import RevisionService
    from app.modules.revisions.schemas import RevisionCreateRequest
    from app.modules.scores.service import ScoreService
    from app.modules.scores.schemas import ScoreUpdateRequest
    from tests.support.revision_metadata import drain_revision_metadata

    engine, storage = confirmation
    content = MUSICXML_1.decode().replace(
        "<part-list>", "<work><work-title>Moonlight Sonata</work-title></work><part-list>"
    )
    with Session(engine) as db:
        job = db.scalar(sa.select(ImportJob))
        job.requested_options = {}
        db.commit()
        score_id = (
            review.ImportReviewService(storage=storage)
            .confirm(
                db,
                "job",
                1,
                ReviewConfirmRequest(content=content),
            )
            .score_id
        )
        drain_revision_metadata(db, storage)
        score = db.scalar(sa.select(Score))
        initial = db.get(ScoreRevision, score.head_revision_id)
        assert score.display_title == "Moonlight Sonata"
        assert db.get(ScoreRevisionMetadata, initial.id).notation_title == "Moonlight Sonata"
        from app.db.models import ScoreMembership
        from app.db.models.score_access import MembershipRole

        db.add(User(id=2, email="reader@example.test", password_hash="hash"))
        db.flush()
        db.add(
            ScoreMembership(
                score_id=score.id, user_id=2, role=MembershipRole.VIEWER, created_by_user_id=1
            )
        )
        db.commit()

        edited = content.replace("Moonlight Sonata", "Moonlight Sonata — edited notation")
        RevisionService(storage=storage).create(
            db,
            score_id,
            1,
            RevisionCreateRequest(
                content=edited,
                expected_head_revision_id=initial.revision_uuid,
            ),
        )
        drain_revision_metadata(db, storage)
        db.refresh(score)
        assert score.display_title == "Moonlight Sonata"
        assert (
            db.get(ScoreRevisionMetadata, score.head_revision_id).notation_title
            == "Moonlight Sonata — edited notation"
        )
        snapshots = list(
            db.scalars(sa.select(Notification).where(Notification.kind == "score.version.created"))
        )
        assert snapshots and all(
            n.score_display_title_snapshot == "Moonlight Sonata" for n in snapshots
        )
        from app.db.models import MailOutbox
        from app.modules.collaboration.invitation_service import InvitationService
        from app.modules.collaboration.schemas import InviteCreateRequest

        invite = InvitationService().create_invite(
            db, score_id, 1, InviteCreateRequest(email="invite@example.com", locale="en")
        )
        assert (
            InvitationService().inspect_invite(db, invite.token, None).score_display_title
            == "Moonlight Sonata"
        )
        mail = db.scalar(sa.select(MailOutbox).where(MailOutbox.recipient == "invite@example.com"))
        assert "Moonlight Sonata" in mail.subject and "edited notation" not in mail.text_body
        mail_snapshot = mail.text_body
        sources = list(db.scalars(sa.select(ScoreRevisionSource)))
        before = {
            source.id: storage.read_bytes(source.stored_object.object_key) for source in sources
        }
        titles = {
            m.revision_id: m.notation_title for m in db.scalars(sa.select(ScoreRevisionMetadata))
        }

        ScoreService(storage=storage).update(
            db,
            score_id,
            1,
            ScoreUpdateRequest(
                display_title="My practice copy",
                expected_metadata_version=score.metadata_version,
            ),
        )
        db.expire_all()
        assert db.get(Score, score.id).display_title == "My practice copy"
        assert {
            m.revision_id: m.notation_title for m in db.scalars(sa.select(ScoreRevisionMetadata))
        } == titles
        assert {
            source.id: storage.read_bytes(source.stored_object.object_key)
            for source in db.scalars(sa.select(ScoreRevisionSource))
        } == before
        assert all(
            n.score_display_title_snapshot == "Moonlight Sonata"
            for n in db.scalars(
                sa.select(Notification).where(Notification.kind == "score.version.created")
            )
        )
        assert db.get(MailOutbox, mail.id).text_body == mail_snapshot


def snapshot(db):
    models = (
        ImportArtifact,
        ImportJobUpload,
        Upload,
        StoredObject,
        StoredObjectRetirement,
        StorageUsageEvent,
        Score,
        ScoreRevision,
        ScoreRevisionSource,
        ScoreRevisionMetadata,
        RenderOutbox,
        PlaybackOutbox,
        RevisionMetadataOutbox,
        ScoreInputAsset,
        Notification,
        RealtimeChange,
        RealtimeStreamState,
    )
    return {
        model.__tablename__: list(
            db.execute(
                sa.select(model.__table__).order_by(*model.__table__.primary_key.columns)
            ).mappings()
        )
        for model in models
    }


def realtime_rows(db):
    return list(
        db.execute(
            sa.select(RealtimeChange.__table__).order_by(
                RealtimeChange.recipient_user_id, RealtimeChange.sequence
            )
        ).mappings()
    )


def assert_confirmation_delta(db, before, notification_id):
    after = realtime_rows(db)
    assert after[: len(before)] == before
    delta = after[len(before) :]
    expected = []
    if notification_id is not None:
        expected.append((1, "notifications.changed", notification_id, None))
    expected.append((1, "import_jobs.changed", None, "job"))
    assert [
        (row["recipient_user_id"], row["kind"], row["notification_id"], row["import_job_id"])
        for row in delta
    ] == expected
    high = before[-1]["sequence"]
    assert [row["sequence"] for row in delta] == list(range(high + 1, high + len(delta) + 1))
    assert db.get(RealtimeStreamState, 1).high_watermark_sequence == high + len(delta)
    return after


@pytest.mark.parametrize("stage", ["writer", "confirmed", "release", "enrichment", "commit"])
def test_confirmation_semantic_transaction_rolls_back_at_every_boundary(
    confirmation, monkeypatch, stage
):
    engine, storage = confirmation
    with Session(engine) as db:
        before = snapshot(db)
        notification_id = db.scalar(sa.select(Notification.notification_uuid))
        counters = {r.category: r.used_bytes for r in db.scalars(sa.select(StorageUsageCounter))}

    def interrupted():
        raise RuntimeError("confirmation interrupted")

    if stage == "writer":
        original = review.revision_writer.write

        def write(*args, **kwargs):
            original(*args, **kwargs)
            interrupted()

        monkeypatch.setattr(review.revision_writer, "write", write)
    if stage in {"confirmed", "release"}:
        original = review.ImportJobDeletionService.cleanup_binary_artifacts

        def release(self, db, job, user_id):
            assert job.state == ImportJobState.CONFIRMED
            if stage == "release":
                original(self, db, job, user_id)
            interrupted()

        monkeypatch.setattr(review.ImportJobDeletionService, "cleanup_binary_artifacts", release)
    if stage == "enrichment":
        original = review.admit_import_confirmation_consequences

        def append(*args, **kwargs):
            original(*args, **kwargs)
            assert_confirmation_delta(args[0], before["realtime_changes"], notification_id)
            interrupted()

        monkeypatch.setattr(review, "admit_import_confirmation_consequences", append)

    with Session(engine, expire_on_commit=False) as db:
        adapter = db
        if stage == "commit":
            original = adapter.commit

            def commit():
                if db.scalar(sa.select(ImportJob)).state == ImportJobState.CONFIRMED:
                    assert db.scalar(sa.select(Notification)).score_id is not None
                    assert_confirmation_delta(db, before["realtime_changes"], notification_id)
                    interrupted()
                original()

            monkeypatch.setattr(adapter, "commit", commit)
        with pytest.raises(RuntimeError, match="confirmation interrupted"):
            review.ImportReviewService(storage=storage).confirm(
                adapter, "job", 1, ReviewConfirmRequest(content=MUSICXML_1.decode())
            )
        db.rollback()
        assert snapshot(db) == before
        job = db.scalar(sa.select(ImportJob))
        assert job.state == ImportJobState.READY_FOR_REVIEW and job.score_id is None
        assert job.confirmed_at is None
        assert db.scalar(sa.select(Notification)).score_id is None
        assert db.scalar(sa.select(Notification)).score_display_title_snapshot is None
        for counter in db.scalars(sa.select(StorageUsageCounter)):
            assert counter.used_bytes == counters.get(counter.category, 0)
            assert counter.reserved_bytes == 0
        intents = list(db.scalars(sa.select(ObjectWriteIntent)))
        assert len(intents) == 2 and all(row.status == "WRITTEN" for row in intents)
        assert len(drain_write_cleanup(db, storage)) == 2
        assert all(not storage.exists(row.object_key) for row in intents)


def test_confirmation_enriches_retained_notification_in_its_transaction(confirmation):
    engine, storage = confirmation
    with Session(engine) as db:
        before = realtime_rows(db)
        notification_id = db.scalar(sa.select(Notification.notification_uuid))
        assert len(before) == 2
    score_id = confirm(engine, storage)
    with Session(engine) as db:
        notifications = list(db.scalars(sa.select(Notification)))
        assert len(notifications) == 1
        assert notifications[0].score_id == score_id
        assert notifications[0].import_job_id == "job"
        assert notifications[0].import_display_title_snapshot == "Etudes"
        assert notifications[0].score_display_title_snapshot == "Etudes"
        after = assert_confirmation_delta(db, before, notification_id)
    assert confirm(engine, storage) == score_id
    with Session(engine) as db:
        assert realtime_rows(db) == after
        assert db.get(RealtimeStreamState, 1).high_watermark_sequence == after[-1]["sequence"]


def test_confirmation_succeeds_without_expired_notification_history(confirmation):
    engine, storage = confirmation
    with Session(engine) as db:
        db.execute(sa.delete(Notification))
        db.commit()
        before = realtime_rows(db)
        assert len(before) == 2
    score_id = confirm(engine, storage)
    with Session(engine) as db:
        assert db.scalar(sa.select(ImportJob)).state == ImportJobState.CONFIRMED
        assert db.scalar(sa.select(Score)).score_uuid == score_id
        assert db.scalar(sa.select(Notification)) is None
        after = assert_confirmation_delta(db, before, None)
    assert confirm(engine, storage) == score_id
    with Session(engine) as db:
        assert realtime_rows(db) == after


@pytest.mark.parametrize("notification_retained", [True, False])
def test_concurrent_confirmation_admits_one_complete_import_transaction(
    confirmation, monkeypatch, notification_retained
):
    engine, storage = confirmation
    with Session(engine) as db:
        notification_id = db.scalar(sa.select(Notification.notification_uuid))
        if not notification_retained:
            db.execute(sa.delete(Notification))
            db.commit()
            notification_id = None
        before = realtime_rows(db)
        assert len(before) == 2
    barrier = Barrier(2)
    original = review.write_object

    def paused(*args, **kwargs):
        result = original(*args, **kwargs)
        barrier.wait(15)
        return result

    monkeypatch.setattr(review, "write_object", paused)
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: confirm(engine, storage), range(2)))
    assert results[0] == results[1]
    with Session(engine) as db:
        for model in (
            Score,
            ScoreRevision,
            ScoreRevisionSource,
            ScoreInputAsset,
            RenderOutbox,
            PlaybackOutbox,
            RevisionMetadataOutbox,
        ):
            assert db.scalar(sa.select(sa.func.count()).select_from(model)) == 1
        assert db.scalar(sa.select(sa.func.count()).select_from(Notification)) == int(
            notification_retained
        )
        if notification_retained:
            assert db.scalar(sa.select(Notification)).score_id == results[0]
        assert_confirmation_delta(db, before, notification_id)
        assert db.scalar(sa.select(ImportArtifact)) is None
        assert db.scalar(sa.select(ImportJobUpload)) is None
        assert {r.category: r.used_bytes for r in db.scalars(sa.select(StorageUsageCounter))} == {
            StorageUsageCategory.SOURCE: db.scalar(
                sa.select(ScoreRevisionSource)
            ).stored_object.byte_size,
            StorageUsageCategory.INPUT_ASSET: 8,
            StorageUsageCategory.UPLOAD: 0,
            StorageUsageCategory.TEMP_IMPORT: 0,
        }


@pytest.mark.parametrize("winner", ["confirm", "delete"])
def test_confirmation_and_deletion_serialize_on_dispatch_before_job(
    confirmation, monkeypatch, winner
):
    engine, storage = confirmation
    entered, release = Event(), Event()
    waiting_pid = Queue()

    def wait_until_blocked(owner, contender):
        deadline = monotonic() + 10
        with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
            while not observer.scalar(
                sa.text("SELECT :owner = ANY(pg_blocking_pids(:contender))"),
                {"owner": owner, "contender": contender},
            ):
                assert monotonic() < deadline

    # Pause the winner after its final canonical locks, before semantic release.
    original = review.ImportJobDeletionService._release
    owner_pid = Queue()

    def paused(self, db, job, user_id, *, delete_job):
        if delete_job == (winner == "delete"):
            db.execute(sa.select(ImportDispatch).with_for_update())
            db.execute(sa.select(ImportJob).with_for_update())
            owner_pid.put(db.scalar(sa.text("SELECT pg_backend_pid()")))
            entered.set()
            assert release.wait(15)
        return original(self, db, job, user_id, delete_job=delete_job)

    monkeypatch.setattr(review.ImportJobDeletionService, "_release", paused)

    def run(kind, contender=False):
        with Session(engine, expire_on_commit=False) as db:
            if contender:
                waiting_pid.put(db.scalar(sa.text("SELECT pg_backend_pid()")))
            try:
                if kind == "confirm":
                    return review.ImportReviewService(storage=storage).confirm(
                        db,
                        "job",
                        1,
                        ReviewConfirmRequest(content=MUSICXML_1.decode()),
                    )
                ImportJobService().delete(db, "job", 1)
            except (ResourceNotFoundException, ValidationException) as exc:
                db.rollback()
                return exc

    with ThreadPoolExecutor(max_workers=2) as pool:
        first = pool.submit(run, winner)
        assert entered.wait(15)
        second = pool.submit(run, "delete" if winner == "confirm" else "confirm", True)
        try:
            wait_until_blocked(owner_pid.get(timeout=10), waiting_pid.get(timeout=10))
        finally:
            release.set()
        first.result(timeout=20)
        assert isinstance(
            second.result(timeout=20), (ResourceNotFoundException, ValidationException)
        )
    with Session(engine) as db:
        job = db.scalar(sa.select(ImportJob))
        if winner == "confirm":
            assert job.state == ImportJobState.CONFIRMED and job.score_id is not None
            assert db.scalar(sa.select(Score)).originating_job_id == job.id
        else:
            assert job is None and db.scalar(sa.select(Score)) is None
        assert db.scalar(sa.select(ImportArtifact)) is None
        assert db.scalar(sa.select(ImportJobUpload)) is None


@pytest.mark.parametrize("command_kind", ["confirm", "delete"])
def test_import_commands_wait_on_dispatch_without_holding_job(confirmation, command_kind):
    engine, storage = confirmation
    pid = Queue()

    def execute():
        with Session(engine, expire_on_commit=False) as db:
            pid.put(db.scalar(sa.text("SELECT pg_backend_pid()")))
            adapter = db
            if command_kind == "confirm":
                return review.ImportReviewService(storage=storage).confirm(
                    adapter, "job", 1, ReviewConfirmRequest(content=MUSICXML_1.decode())
                )
            return ImportJobService().delete(adapter, "job", 1)

    with ThreadPoolExecutor(max_workers=1) as pool, Session(engine) as holder:
        holder.scalar(sa.select(ImportDispatch).with_for_update())
        owner = holder.scalar(sa.text("SELECT pg_backend_pid()"))
        future = pool.submit(execute)
        contender = pid.get(timeout=10)
        try:
            deadline = monotonic() + 10
            with engine.connect().execution_options(isolation_level="AUTOCOMMIT") as observer:
                while not observer.scalar(
                    sa.text("SELECT :owner = ANY(pg_blocking_pids(:contender))"),
                    {"owner": owner, "contender": contender},
                ):
                    assert monotonic() < deadline
            assert holder.scalar(sa.select(ImportJob).with_for_update(nowait=True)) is not None
        finally:
            holder.rollback()
        future.result(timeout=20)
