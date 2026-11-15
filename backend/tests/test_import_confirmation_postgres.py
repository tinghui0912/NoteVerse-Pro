"""Import confirmation commits provenance, revision admission, facts and release together."""

import asyncio
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
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
    NotificationEvent,
    RealtimeEvent,
)
from app.db.models.import_job import ImportJobState
from app.db.models.domain_event import DomainEvent, DomainProjectionCheckpoint
from app.modules.import_jobs.review import service as review
from app.modules.import_jobs.review.schemas import ReviewConfirmRequest
from app.modules.import_jobs.service import ImportJobService
from app.modules.import_jobs.events import ImportJobCompleted, ImportJobConfirmed
from app.modules.import_jobs.projections import IMPORT_PROJECTIONS, project_import_notification
from app.modules.domain_events.journal import append_fact
from app.modules.domain_events.projections import run_projection_batch, run_projections
from app.modules.storage_objects.persistence import object_from_bytes
from app.modules.storage_usage.service import storage_usage_service
from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.utils.timezone import utc_now_naive
from tests.support.postgres_schema import postgres_schema_database
from tests.support.object_storage import InMemoryObjectStorage
from tests.support.write_cleanup import drain_write_cleanup
from tests.test_score_revision_services import AsyncSessionAdapter, MUSICXML_1


@pytest.fixture
def confirmation(monkeypatch):
    with postgres_schema_database(monkeypatch) as (engine, config):
        command.upgrade(config, "head")
        storage = InMemoryObjectStorage()
        with Session(engine) as db:
            db.add(User(id=1, email="confirm@example.test", password_hash="hash"))
            db.flush()
            job = ImportJob(
                job_uuid="job",
                user_id=1,
                state=ImportJobState.PENDING_REVIEW,
                requested_options={"title": "Etudes"},
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
                storage_usage_service.record_allocation_sync(
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
            storage_usage_service.record_allocation_sync(
                db,
                user_id=1,
                category=StorageUsageCategory.UPLOAD,
                bytes_count=8,
                reason="fixture",
                object_type="upload",
            )
            append_fact(
                db,
                ImportJobCompleted(job_id="job", recipient_user_id=1, requested_title="Etudes"),
                occurred_at=utc_now_naive(),
            )
            db.commit()

        async def latency_only(*args):
            pass

        monkeypatch.setattr(review, "revision_fast_path", latency_only)
        yield engine, storage


def confirm(engine, storage):
    with Session(engine, expire_on_commit=False) as db:
        return asyncio.run(
            review.ImportReviewService(storage=storage).confirm(
                AsyncSessionAdapter(db), "job", 1, ReviewConfirmRequest(content=MUSICXML_1.decode())
            )
        ).score_id


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
        DomainEvent,
    )
    return {
        model.__tablename__: list(
            db.execute(
                sa.select(model.__table__).order_by(*model.__table__.primary_key.columns)
            ).mappings()
        )
        for model in models
    }


@pytest.mark.parametrize("stage", ["writer", "confirmed", "release", "fact", "commit"])
def test_confirmation_semantic_transaction_rolls_back_at_every_boundary(
    confirmation, monkeypatch, stage
):
    engine, storage = confirmation
    with Session(engine) as db:
        before = snapshot(db)
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

        async def release(self, db, job, user_id):
            assert job.state == ImportJobState.CONFIRMED
            if stage == "release":
                await original(self, db, job, user_id)
            interrupted()

        monkeypatch.setattr(review.ImportJobDeletionService, "cleanup_binary_artifacts", release)
    if stage == "fact":
        original = review.append_fact

        def append(*args, **kwargs):
            original(*args, **kwargs)
            interrupted()

        monkeypatch.setattr(review, "append_fact", append)

    with Session(engine, expire_on_commit=False) as db:
        adapter = AsyncSessionAdapter(db)
        if stage == "commit":
            original = adapter.commit

            async def commit():
                if db.scalar(sa.select(ImportJob)).state == ImportJobState.CONFIRMED:
                    assert db.scalar(
                        sa.select(DomainEvent).where(
                            DomainEvent.event_type == ImportJobConfirmed.event_type
                        )
                    )
                    interrupted()
                await original()

            monkeypatch.setattr(adapter, "commit", commit)
        with pytest.raises(RuntimeError, match="confirmation interrupted"):
            asyncio.run(
                review.ImportReviewService(storage=storage).confirm(
                    adapter, "job", 1, ReviewConfirmRequest(content=MUSICXML_1.decode())
                )
            )
        db.rollback()
        assert snapshot(db) == before
        job = db.scalar(sa.select(ImportJob))
        assert job.state == ImportJobState.PENDING_REVIEW and job.score_id is None
        for counter in db.scalars(sa.select(StorageUsageCounter)):
            assert counter.used_bytes == counters.get(counter.category, 0)
            assert counter.reserved_bytes == 0
        intents = list(db.scalars(sa.select(ObjectWriteIntent)))
        assert len(intents) == 2 and all(row.status == "WRITTEN" for row in intents)
        assert len(drain_write_cleanup(db, storage)) == 2
        assert all(not storage.exists(row.object_key) for row in intents)


def test_confirmation_projection_replays_and_recovers_independently(confirmation):
    engine, storage = confirmation
    score_id = confirm(engine, storage)
    assert confirm(engine, storage) == score_id
    with Session(engine) as db:
        # Rebuild only the notification representation/checkpoint from journal truth.
        db.execute(sa.delete(NotificationEvent))
        db.execute(sa.delete(RealtimeEvent))
        db.execute(sa.delete(DomainProjectionCheckpoint))
        db.commit()
        assert run_projection_batch(db, IMPORT_PROJECTIONS[0], batch_size=1) == 1
        checkpoint = db.get(DomainProjectionCheckpoint, "import_notifications_v1").last_event_id

        def interrupted(db, event, fact):
            project_import_notification(db, event, fact)
            if isinstance(fact, ImportJobConfirmed):
                db.flush()
                raise RuntimeError("enrichment interrupted")

        with pytest.raises(ExceptionGroup):
            run_projections(
                db, (replace(IMPORT_PROJECTIONS[0], handle=interrupted), IMPORT_PROJECTIONS[1])
            )
        assert (
            db.get(DomainProjectionCheckpoint, "import_notifications_v1").last_event_id
            == checkpoint
        )
        assert db.scalar(sa.select(NotificationEvent)).score_id is None
        assert db.get(DomainProjectionCheckpoint, "import_realtime_v1").last_event_id > checkpoint
        assert db.scalar(sa.select(ImportJob)).state == ImportJobState.CONFIRMED
        run_projections(db, IMPORT_PROJECTIONS)
        run_projections(db, IMPORT_PROJECTIONS)
        notifications = list(db.scalars(sa.select(NotificationEvent)))
        assert len(notifications) == 1
        assert notifications[0].score_id == score_id
        assert notifications[0].data == {
            "job_id": "job",
            "job_title": "Etudes",
            "score_id": score_id,
            "score_title": "Etudes",
        }
        assert (
            db.scalar(
                sa.select(sa.func.count())
                .select_from(DomainEvent)
                .where(DomainEvent.event_type == ImportJobConfirmed.event_type)
            )
            == 1
        )
        assert {row.type for row in db.scalars(sa.select(RealtimeEvent))} == {
            "notification.created",
            "import_job.completed",
        }


def test_confirmation_projection_requires_completed_evidence(confirmation):
    engine, storage = confirmation
    confirm(engine, storage)
    with Session(engine) as db:
        event = db.scalar(
            sa.select(DomainEvent).where(DomainEvent.event_type == ImportJobConfirmed.event_type)
        )
        db.execute(sa.delete(NotificationEvent))
        db.commit()
        with pytest.raises(RuntimeError, match="requires its completed"):
            project_import_notification(db, event, ImportJobConfirmed.model_validate(event.payload))


def test_concurrent_confirmation_admits_one_complete_import_transaction(confirmation, monkeypatch):
    engine, storage = confirmation
    barrier = Barrier(2)
    original = review.write_object_async

    async def paused(*args, **kwargs):
        result = await original(*args, **kwargs)
        barrier.wait(15)
        return result

    monkeypatch.setattr(review, "write_object_async", paused)
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
        assert db.scalar(sa.select(sa.func.count()).select_from(DomainEvent)) == 3
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

    async def paused(self, db, job, user_id, *, delete_job):
        if delete_job == (winner == "delete"):
            await db.execute(sa.select(ImportDispatch).with_for_update())
            await db.execute(sa.select(ImportJob).with_for_update())
            owner_pid.put(await db.scalar(sa.text("SELECT pg_backend_pid()")))
            entered.set()
            assert release.wait(15)
        return await original(self, db, job, user_id, delete_job=delete_job)

    monkeypatch.setattr(review.ImportJobDeletionService, "_release", paused)

    def run(kind, contender=False):
        with Session(engine, expire_on_commit=False) as db:
            if contender:
                waiting_pid.put(db.scalar(sa.text("SELECT pg_backend_pid()")))
            try:
                if kind == "confirm":
                    return asyncio.run(
                        review.ImportReviewService(storage=storage).confirm(
                            AsyncSessionAdapter(db),
                            "job",
                            1,
                            ReviewConfirmRequest(content=MUSICXML_1.decode()),
                        )
                    )
                asyncio.run(ImportJobService().delete(AsyncSessionAdapter(db), "job", 1))
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
            adapter = AsyncSessionAdapter(db)
            if command_kind == "confirm":
                return asyncio.run(
                    review.ImportReviewService(storage=storage).confirm(
                        adapter, "job", 1, ReviewConfirmRequest(content=MUSICXML_1.decode())
                    )
                )
            return asyncio.run(ImportJobService().delete(adapter, "job", 1))

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
