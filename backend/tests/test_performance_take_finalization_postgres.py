"""Take adoption preserves holds, lease fencing, atomic publication and shared media authority."""

from concurrent.futures import ThreadPoolExecutor
from threading import Event
from unittest.mock import Mock, patch
import pytest
from sqlalchemy import select, func
from app.composition import media_resources as wiring
from app.composition import storage_resources as resources
from app.db.models import (
    PerformanceTake,
    PerformanceTakeUploadReservation,
    UploadSession,
    StorageUsageAccount,
    TakeProcessingOutbox,
)
from app.modules.performance_takes.manifest_persistence import manifest_from_row
from app.modules.media_storage.upload_sessions.domain import UploadStatus
from app.storage.base import DirectUploadTarget
from tests.test_upload_reservation_postgres import setup_bundle, MEDIA

pytest_plugins = ["tests.test_practice_bundle_postgres"]


def setup(postgres_bundle):
    sessions, source, storage, request = setup_bundle(postgres_bundle)
    reservations = wiring.build_take_reservation_service(storage)
    finalization = wiring.build_take_finalization_service(storage)
    with sessions() as db:
        accepted = reservations.reserve_upload(db, 1, request)
    transfer = accepted.upload_session
    target = transfer.upload_target
    storage.receive_upload(DirectUploadTarget(target.url, target.method, target.headers), MEDIA)
    reservations.uploads.complete(transfer.session_id, 1)
    with sessions() as db:
        row = reservations.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
        manifest = manifest_from_row(row.manifest)
        key = row.upload_session.object_key
    return sessions, reservations, finalization, storage, request, accepted, manifest, key


@pytest.mark.parametrize("stage", ["consume", "take", "quota", "allocation"])
def test_failed_semantic_admission_rolls_back_take_session_and_allocation(
    postgres_bundle, monkeypatch, stage
):
    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    target, method = (
        (service.uploads, "consume")
        if stage == "consume"
        else (service.repository, "create_take")
        if stage == "take"
        else (service.writer.quota, "consume_hold")
        if stage == "quota"
        else (service.writer.storage_usage_service, "record_allocation")
    )
    original = getattr(target, method)

    def fail(*args, **kwargs):
        original(*args, **kwargs)
        raise RuntimeError("admission interrupted")

    with patch.object(target, method, side_effect=fail):
        with sessions() as db:
            with pytest.raises(RuntimeError, match="interrupted"):
                service.finalize_take(db, 1, accepted.reservation_id)
    with sessions() as db:
        assert db.scalar(select(PerformanceTake)) is None
        assert db.scalar(select(UploadSession)).status == UploadStatus.COMPLETED
        assert db.get(StorageUsageAccount, 1).used_bytes == 0
        assert resources.storage_quota_service.snapshot_user(db, 1).reserved_bytes == len(MEDIA)
        assert db.scalar(select(PerformanceTakeUploadReservation)).status == "RESERVED"
    with sessions() as db:
        assert service.finalize_take(db, 1, accepted.reservation_id).media_status == "READY"


def test_repeated_finalize_has_one_take_allocation_and_consumption(postgres_bundle):
    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    with sessions() as db:
        first = service.finalize_take(db, 1, accepted.reservation_id)
        second = service.finalize_take(db, 1, accepted.reservation_id)
        assert first == second
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(PerformanceTake)) == 1
        assert db.get(StorageUsageAccount, 1).used_bytes == len(MEDIA)
        assert db.scalar(select(UploadSession)).status == UploadStatus.CONSUMED
        assert resources.storage_quota_service.snapshot_user(db, 1).reserved_bytes == 0


def test_large_take_promotion_never_reads_or_copies_and_worker_enriches_digest(postgres_bundle):
    sessions, source, storage, request = setup_bundle(postgres_bundle)
    size = 21 * 1024**2
    with sessions() as db:
        from app.db.models import StoragePlanPolicy

        db.get(StoragePlanPolicy, "FREE").default_limit_bytes = 100 * 1024**2
        db.commit()
    request = request.model_copy(
        update={"media": request.media.model_copy(update={"byte_size": size})}
    )
    reservations = wiring.build_take_reservation_service(storage)
    finalization = wiring.build_take_finalization_service(storage)
    with sessions() as db:
        accepted = reservations.reserve_upload(db, 1, request)
    transfer = accepted.upload_session
    for n in (1, 2):
        target = reservations.uploads.part_url(transfer.session_id, 1, n)
        content = (
            (b"\x1aE\xdf\xa3" + b"x" * (int(target.headers["content-length"]) - 4))
            if n == 1
            else b"x" * int(target.headers["content-length"])
        )
        storage.receive_upload(
            DirectUploadTarget(target.url, target.method, target.headers), content
        )
    reservations.uploads.complete(transfer.session_id, 1)
    with (
        patch.object(storage, "iter_bytes", side_effect=AssertionError("HTTP reads large media")),
        patch.object(storage, "copy", side_effect=AssertionError("Multipart copy")),
    ):
        with sessions() as db:
            saved = finalization.finalize_take(db, 1, accepted.reservation_id)
    assert saved.media_status == "UPLOADED"
    with sessions() as db:
        take = db.scalar(select(PerformanceTake))
        assert take.recording_object.sha256 is None
        uuid = db.scalar(select(TakeProcessingOutbox.operation_uuid))
    assert wiring.build_take_processing_service(storage).execute(uuid) == "completed"
    with sessions() as db:
        take = db.scalar(select(PerformanceTake))
        assert take.media_status == "READY" and len(take.recording_object.sha256) == 64
    from app.modules.media_storage.upload_sessions.maintenance import UploadSessionMaintenance

    storage.delete = Mock(wraps=storage.delete)
    UploadSessionMaintenance(reservations.uploads).run()
    storage.delete.assert_not_called()


def test_finalizing_lease_excludes_concurrent_finalize_until_committed_winner(postgres_bundle):
    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    entered, release = Event(), Event()
    copy = service.uploads.prepare_adoption

    def held(*args, **kwargs):
        entered.set()
        assert release.wait(10)
        return copy(*args, **kwargs)

    with patch.object(service.uploads, "prepare_adoption", side_effect=held):
        with ThreadPoolExecutor(2) as pool:

            def finalize():
                with sessions() as db:
                    return service.finalize_take(db, 1, accepted.reservation_id)

            first = pool.submit(finalize)
            try:
                assert entered.wait(10)
                from app.core.exceptions import ValidationException

                with pytest.raises(ValidationException):
                    pool.submit(finalize).result(10)
            finally:
                release.set()
            assert first.result(10).take_id == accepted.take_id
    with sessions() as db:
        assert db.scalar(select(func.count()).select_from(PerformanceTake)) == 1


def test_reservation_expiry_during_finalize_releases_capacity_without_publishing_take(
    postgres_bundle,
):
    from datetime import timedelta
    from app.shared.time import utc_now
    from app.db.models import StorageQuotaHold
    from app.core.exceptions import ValidationException

    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    entered, release = Event(), Event()
    prepare = service.uploads.prepare_adoption

    def paused(*args, **kwargs):
        entered.set()
        assert release.wait(10)
        return prepare(*args, **kwargs)

    def finalize():
        with sessions() as db:
            return service.finalize_take(db, 1, accepted.reservation_id)

    with (
        patch.object(service.uploads, "prepare_adoption", side_effect=paused),
        ThreadPoolExecutor(1) as pool,
    ):
        active = pool.submit(finalize)
        try:
            assert entered.wait(10)
            with sessions() as db:
                row = db.scalar(select(PerformanceTakeUploadReservation).with_for_update())
                row.expires_at = utc_now() - timedelta(seconds=1)
                db.commit()
                assert wiring.build_take_reservation_cleanup_service(storage).expire(db) == 1
                db.commit()
        finally:
            release.set()
        with pytest.raises((ValueError, ValidationException)):
            active.result(10)
    with sessions() as db:
        assert db.scalar(select(PerformanceTake)) is None
        assert db.get(StorageUsageAccount, 1).used_bytes == 0
        assert db.scalar(select(StorageQuotaHold)).status == "RELEASED"
        assert db.scalar(select(UploadSession)).status == UploadStatus.CANCELLED
