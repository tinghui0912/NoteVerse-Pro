"""Real PostgreSQL execution of the Take deletion completion lock protocol."""

import asyncio
from contextlib import contextmanager, nullcontext

import pytest
from sqlalchemy import create_engine, select, text
from sqlalchemy.exc import OperationalError
from sqlalchemy.orm import Session

from app.db.models import (
    MediaBlob,
    PerformanceTake,
    PerformanceTakeDeleteOutbox,
    PerformanceTakeManifest,
    PerformanceTakeUploadReservation,
    StorageUsageAccount,
)
from app.modules.performance_takes.upload_reservation.service import PerformanceTakeUploadService
from app.modules.performance_takes.manifest_persistence import manifest_from_row
from app.worker.execution import performance_take_deletion as worker
from tests.test_upload_reservation_postgres import setup_bundle, MEDIA

pytest_plugins = ["tests.test_practice_bundle_postgres"]


@pytest.mark.asyncio
async def test_worker_completion_locks_outbox_and_take_separately_and_preserves_manifest(
    postgres_bundle, monkeypatch
):
    sessions, bundle_service, storage, request = await setup_bundle(postgres_bundle)
    service = PerformanceTakeUploadService(storage=storage, practice_bundle_service=bundle_service)
    async with sessions() as db:
        accepted = await service.reserve_upload(db, 1, request)
        reservation = await service.repository.get_reservation_by_uuid(
            db, 1, accepted.reservation_id
        )
        manifest_id = reservation.manifest_id
        manifest = manifest_from_row(reservation.manifest)
        storage.put_bytes(
            key=reservation.staging_object_key, content=MEDIA, content_type="audio/webm"
        )
        take_read = await service.finalize_take(db, 1, accepted.reservation_id)
        take = await service.repository.get_by_uuid(db, 1, take_read.take_id)
        take_id, final_key = take.id, take.media_blob.object_key
        blob_id = take.media_blob_id
        await service.takes.delete_take(db, 1, take_read.take_id)
        outbox = await db.scalar(select(PerformanceTakeDeleteOutbox))
        outbox_id, outbox_uuid = outbox.id, outbox.outbox_uuid
        schema = await db.scalar(text("SELECT current_schema()"))
        await db.commit()

    engine = create_engine(
        postgres_bundle[0].url.set(drivername="postgresql+psycopg"),
        connect_args={"options": f"-csearch_path={schema}"},
    )
    observations = []

    def assert_lock(model, identity, *, blocked):
        with Session(engine) as observer:
            statement = select(model).where(model.id == identity).with_for_update(nowait=True)
            if blocked:
                with pytest.raises(OperationalError) as error:
                    observer.execute(statement)
                assert error.value.orig.sqlstate == "55P03"
            else:
                assert observer.execute(statement).scalar_one() is not None

    class CompletionSession(Session):
        def execute(self, statement, *args, **kwargs):
            result = super().execute(statement, *args, **kwargs)
            entities = [
                item.get("entity") for item in getattr(statement, "column_descriptions", [])
            ]
            if getattr(statement, "_for_update_arg", None) is not None:
                if entities == [PerformanceTakeDeleteOutbox] and not observations:
                    assert_lock(PerformanceTakeDeleteOutbox, outbox_id, blocked=True)
                    assert_lock(PerformanceTake, take_id, blocked=False)
                    observations.append("outbox locked")
                elif entities == [PerformanceTake]:
                    assert_lock(PerformanceTakeDeleteOutbox, outbox_id, blocked=True)
                    assert_lock(PerformanceTake, take_id, blocked=True)
                    assert_lock(PerformanceTakeManifest, manifest_id, blocked=False)
                    assert_lock(MediaBlob, blob_id, blocked=False)
                    observations.append("Take locked; Manifest unlocked")
            return result

    # Observe only completion transactions, after the physical deletion has finished.
    @contextmanager
    def transaction():
        session_type = Session if storage.exists(final_key) else CompletionSession
        with session_type(engine) as db:
            yield db

    monkeypatch.setattr(worker, "get_worker_db", transaction)
    monkeypatch.setattr(worker, "object_storage", storage)
    monkeypatch.setattr(worker, "start_attempt_trace", lambda **kwargs: nullcontext())
    delete = storage.delete
    concurrent_results = []

    def delete_with_duplicate(key):
        # A second delivery cannot claim the currently PROCESSING attempt.
        concurrent_results.append(worker.execute_performance_take_deletion_task(None, outbox_uuid))
        delete(key)

    monkeypatch.setattr(storage, "delete", delete_with_duplicate)
    try:
        result = await asyncio.to_thread(
            worker.execute_performance_take_deletion_task, None, outbox_uuid
        )
        assert result["status"] == "deleted"
        assert concurrent_results[0]["status"] == "ignored"
        assert observations == ["outbox locked", "Take locked; Manifest unlocked"]
        with Session(engine) as db:
            assert db.get(PerformanceTake, take_id) is None
            assert db.get(MediaBlob, blob_id) is None
            assert not storage.exists(final_key)
            assert manifest_from_row(db.get(PerformanceTakeManifest, manifest_id)) == manifest
            retained = db.scalar(select(PerformanceTakeUploadReservation))
            assert retained.manifest_id == manifest_id and retained.status == "COMPLETED"
            account = db.get(StorageUsageAccount, 1)
            assert account.used_bytes == account.reserved_bytes == 0
            completed = db.get(PerformanceTakeDeleteOutbox, outbox_id)
            assert completed.status == "COMPLETED" and completed.attempt_count == 1
    finally:
        engine.dispose()
