"""Upload reservation ownership across independent PostgreSQL transactions."""

from __future__ import annotations

import asyncio
from datetime import timedelta
from threading import Event

import pytest
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.exceptions import ValidationException
from app.db.models import (
    StoredObject,
    PracticeBundleRecord,
    StorageUsageAccount,
    StorageUsageCounter,
    StorageUsageCategory,
)
from app.db.models.performance_take_manifest import PerformanceTakeManifest
from app.db.models.performance_take import PerformanceTake
from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from app.db.models.storage_usage import StorageUsageReservation
from app.modules.performance_takes.manifest_persistence import manifest_from_row
from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.performance_takes.schemas import PerformanceTakeUploadReservationRequest
from app.modules.performance_takes.upload_reservation.service import PerformanceTakeUploadService
from app.modules.performance_takes.upload_reservation.cleanup import (
    upload_reservation_cleanup_service,
)
from app.modules.performance_takes.upload_reservation.persistence import (
    lifecycle_from_row,
    initialize_lifecycle,
)
from app.modules.performance_takes.upload_reservation.domain import FinalizeLease
from app.modules.storage_usage.service import StorageUsageService
from app.modules.practice.bundle.service import PracticeBundleService
from app.utils.timezone import utc_now_naive

pytest_plugins = ["tests.test_practice_bundle_postgres"]

MEDIA = b"\x1a\x45\xdf\xa3" + b"reserved-recording"


@pytest.mark.parametrize("command", ["cancel", "expire", "expire-finalizing"])
@pytest.mark.asyncio
async def test_terminal_transitions_atomically_release_quota_and_preserve_provenance(
    postgres_bundle, command
):
    from unittest.mock import patch
    from app.db.models import PracticeBundleRecord
    from app.utils.timezone import utc_now_naive

    sessions, source, storage, request = await setup_bundle(postgres_bundle)
    service = PerformanceTakeUploadService(storage=storage, practice_bundle_service=source)
    async with sessions() as db:
        reserved = await service.reserve_upload(db, 1, request)
        row = await service.repository.get_reservation_by_uuid(db, 1, reserved.reservation_id)
        bundle_id = row.manifest.practice_bundle_id
        assert (
            await db.scalar(
                select(PracticeBundleRecord).where(PracticeBundleRecord.bundle_id == bundle_id)
            )
        ).status == "READY"
        now = utc_now_naive()
        if command == "expire-finalizing":
            state = lifecycle_from_row(row)
            initialize_lifecycle(
                row,
                state.begin_finalize(
                    lease=FinalizeLease(
                        "worker-token", "worker-candidate", now + timedelta(minutes=15)
                    ),
                    now=now,
                ).after,
            )
            await db.commit()
            assert row.manifest.practice_bundle_id == bundle_id
        if command == "cancel":
            await service.cancel_upload_reservation(db, 1, reserved.reservation_id)
            # Idempotent cancellation does not release quota twice.
            await service.cancel_upload_reservation(db, 1, reserved.reservation_id)
        else:
            await db.commit()
            with patch(
                "app.modules.performance_takes.upload_reservation.cleanup.utc_now_naive",
                return_value=now + timedelta(hours=2),
            ):
                await db.run_sync(
                    lambda sync_db: upload_reservation_cleanup_service.cleanup_expired_reservations(
                        sync_db, storage, StorageUsageService()
                    )
                )
        await db.refresh(row)
        assert row.status == ("CANCELLED" if command == "cancel" else "EXPIRED")
        assert row.manifest.practice_bundle_id == bundle_id
        assert (
            row.finalizing_token is row.finalizing_object_key is row.finalizing_expires_at is None
        )
        account = await db.get(StorageUsageAccount, 1)
        assert account.reserved_bytes == account.used_bytes == 0
        if command == "expire-finalizing":
            assert "worker-candidate" in row.orphan_final_object_keys


@pytest.mark.asyncio
async def test_take_creation_completion_and_quota_commit_share_one_transaction(postgres_bundle):
    from unittest.mock import patch

    sessions, source, storage, request = await setup_bundle(postgres_bundle)
    service = PerformanceTakeUploadService(storage=storage, practice_bundle_service=source)
    async with sessions() as db:
        reserved = await service.reserve_upload(db, 1, request)
        row = await service.repository.get_reservation_by_uuid(db, 1, reserved.reservation_id)
        bundle_id = row.manifest.practice_bundle_id
        storage.put_bytes(key=row.staging_object_key, content=MEDIA, content_type="audio/webm")
        await db.commit()

        async def fail_commit(*args, **kwargs):
            raise RuntimeError("quota transaction rejected")

        with patch.object(
            service.storage_usage_service, "commit_reservation", side_effect=fail_commit
        ):
            with pytest.raises(RuntimeError, match="quota transaction rejected"):
                await service.finalize_take(db, 1, reserved.reservation_id)
        await db.rollback()
    async with sessions() as observer:
        row = await service.repository.get_reservation_by_uuid(observer, 1, reserved.reservation_id)
        assert row.status == "FINALIZING" and row.manifest.practice_bundle_id == bundle_id
        assert await observer.scalar(select(func.count()).select_from(PerformanceTake)) == 0
        bundle_objects = set(
            (
                await observer.execute(
                    select(
                        PracticeBundleRecord.prepared_musicxml_object_id,
                        PracticeBundleRecord.artifact_object_id,
                    )
                )
            ).one()
        )
        assert set((await observer.scalars(select(StoredObject.id))).all()) == bundle_objects
        assert (
            await observer.scalar(
                select(StoredObject).where(StoredObject.object_key == row.finalizing_object_key)
            )
            is None
        )
        account = await observer.get(StorageUsageAccount, 1)
        assert account.reserved_bytes == len(MEDIA) and account.used_bytes == 0


async def setup_bundle(postgres_bundle):
    engine, repository, bundle, storage = postgres_bundle
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        db.add(
            StorageUsageAccount(
                user_id=1,
                plan_code="FREE",
                quota_limit_bytes=1048576,
                used_bytes=0,
                reserved_bytes=0,
            )
        )
        db.add(
            StorageUsageCounter(
                user_id=1, category=StorageUsageCategory.UPLOAD, used_bytes=0, reserved_bytes=0
            )
        )
        await db.commit()
        reference, verified_bundle = await repository.get_or_create(
            db, bundle, revision_id=repository.test_revision_id
        )
    source = PracticeBundleService(repository=repository, storage=storage)
    request = PerformanceTakeUploadReservationRequest.model_validate(
        {
            "client_request_id": "same-request",
            "practice_binding": {
                "score_id": repository.test_score_uuid,
                "revision_id": repository.test_revision_uuid,
                "bundle_id": bundle.bundle_id,
            },
            "media": {
                "kind": "AUDIO",
                "mime_type": "audio/webm",
                "byte_size": len(MEDIA),
            },
            "scope": {"kind": "FULL"},
            "tempo_selection": {"mode": "SCORE"},
            "recording_timebase": {
                "nominalMediaDurationUs": 1000000,
                "activeSegments": [
                    {
                        "performanceStartUs": 0,
                        "performanceEndUs": 1000000,
                        "mediaStartUs": 0,
                        "mediaEndUs": 1000000,
                    }
                ],
            },
        }
    )
    return sessions, source, storage, request


@pytest.mark.asyncio
async def test_two_creators_share_one_reservation_and_one_quota_hold(postgres_bundle):
    sessions, source, storage, request = await setup_bundle(postgres_bundle)
    both_absent = asyncio.Event()
    arrivals = 0

    class SynchronizedRepository(PerformanceTakeRepository):
        async def get_reservation_by_client_request_id(self, *args, **kwargs):
            nonlocal arrivals
            value = await super().get_reservation_by_client_request_id(*args, **kwargs)
            if value is None:
                arrivals += 1
                if arrivals == 2:
                    both_absent.set()
                await asyncio.wait_for(both_absent.wait(), 5)
            return value

    service = PerformanceTakeUploadService(
        repository=SynchronizedRepository(), storage=storage, practice_bundle_service=source
    )
    async with sessions() as a, sessions() as b:
        first, second = await asyncio.wait_for(
            asyncio.gather(
                service.reserve_upload(a, 1, request),
                service.reserve_upload(b, 1, request),
            ),
            15,
        )
        assert first.reservation_id == second.reservation_id
        assert first.take_id == second.take_id
    async with sessions() as db:
        assert (
            await db.scalar(select(func.count()).select_from(PerformanceTakeUploadReservation)) == 1
        )
        assert await db.scalar(select(func.count()).select_from(PerformanceTakeManifest)) == 1
        assert await db.scalar(select(func.count()).select_from(StorageUsageReservation)) == 1
        account = await db.get(StorageUsageAccount, 1)
        assert account.reserved_bytes == len(MEDIA) and account.used_bytes == 0


@pytest.mark.parametrize("takeover", [False, True])
@pytest.mark.asyncio
async def test_finalize_lease_blocks_concurrency_and_expired_takeover_preserves_one_take(
    postgres_bundle, takeover
):
    sessions, source, storage, request = await setup_bundle(postgres_bundle)
    service = PerformanceTakeUploadService(storage=storage, practice_bundle_service=source)
    async with sessions() as a:
        reserved = await service.reserve_upload(a, 1, request)
        row = await service.repository.get_reservation_by_uuid(a, 1, reserved.reservation_id)
        bundle_id = row.manifest.practice_bundle_id
        admitted_manifest = manifest_from_row(row.manifest)
        manifest_id = row.manifest_id
        storage.put_bytes(key=row.staging_object_key, content=MEDIA, content_type="audio/webm")
        await a.commit()
    entered, release = Event(), Event()
    copy = storage.copy
    candidates = []

    def held_copy(source_key, candidate_key):
        candidates.append(candidate_key)
        if len(candidates) == 1:
            entered.set()
            assert release.wait(15), "Finalize copy was not released"
        return copy(source_key, candidate_key)

    storage.copy = held_copy
    async with sessions() as a, sessions() as b:
        # Retain RESERVED in B's identity map before A acquires its lease.
        cached = await service.repository.get_reservation_by_uuid(b, 1, reserved.reservation_id)
        await b.commit()
        first = asyncio.create_task(service.finalize_take(a, 1, reserved.reservation_id))
        try:
            assert await asyncio.to_thread(entered.wait, 10)
            current_observation = await service.repository.get_reservation_by_uuid(
                b, 1, reserved.reservation_id
            )
            assert current_observation.status == "FINALIZING"
            assert current_observation.manifest_id == manifest_id
            assert manifest_from_row(current_observation.manifest) == admitted_manifest
            await b.commit()
            if takeover:
                current = await service.repository.get_reservation_by_uuid(
                    b, 1, reserved.reservation_id, lock=True
                )
                assert current is cached and current.status == "FINALIZING"
                current.finalizing_expires_at = utc_now_naive() - timedelta(seconds=1)
                await b.commit()
                completed = await service.finalize_take(b, 1, reserved.reservation_id)
            else:
                with pytest.raises(ValidationException) as failure:
                    await service.finalize_take(b, 1, reserved.reservation_id)
                assert failure.value.details["reason"] == "finalize_in_progress"
            release.set()
            completed_first = await first
            repeated = await service.finalize_take(b, 1, reserved.reservation_id)
            assert completed_first.take_id == repeated.take_id == reserved.take_id
            if takeover:
                assert completed.take_id == repeated.take_id
        finally:
            release.set()
            if not first.done():
                await first
    async with sessions() as db:
        assert await db.scalar(select(func.count()).select_from(PerformanceTake)) == 1
        row = await service.repository.get_reservation_by_uuid(db, 1, reserved.reservation_id)
        take = await service.repository.get_by_reservation(db, 1, row.id)
        bundle_objects = set(
            (
                await db.execute(
                    select(
                        PracticeBundleRecord.prepared_musicxml_object_id,
                        PracticeBundleRecord.artifact_object_id,
                    )
                )
            ).one()
        )
        assert set((await db.scalars(select(StoredObject.id))).all()) == bundle_objects | {
            take.recording_object_id
        }
        assert take.manifest.take_uuid == reserved.take_id and row.status == "COMPLETED"
        assert take.manifest_id == row.manifest_id == manifest_id
        assert manifest_from_row(row.manifest) == admitted_manifest
        assert manifest_from_row(take.manifest) == admitted_manifest
        assert (
            row.manifest.practice_bundle_id == bundle_id
            and take.manifest.practice_bundle_id == bundle_id
        )
        assert row.reservation_uuid != row.storage_reservation_id
        assert storage.read_bytes(take.recording_object.object_key) == MEDIA
        import hashlib

        assert take.recording_object.sha256 == hashlib.sha256(MEDIA).hexdigest()
        assert take.recording_object.byte_size == len(MEDIA)
        if takeover:
            assert candidates[0] in row.orphan_final_object_keys
            assert candidates[0] != take.recording_object.object_key
        account = await db.get(StorageUsageAccount, 1)
        assert account.used_bytes == len(MEDIA) and account.reserved_bytes == 0


@pytest.mark.asyncio
async def test_exact_bundle_admission_lock_fences_owner_release_until_reservation_commit(
    postgres_bundle,
):
    from sqlalchemy import delete, text, update
    from app.db.models import Score, ScoreRevision, PracticeBundleRecord
    from app.modules.practice.bundle.retention import practice_bundle_retention

    sessions, source, storage, request = await setup_bundle(postgres_bundle)
    service = PerformanceTakeUploadService(storage=storage, practice_bundle_service=source)
    admitted, release = asyncio.Event(), asyncio.Event()
    authorize = source.authorize_bundle_for_save

    async def held_authorize(*args, **kwargs):
        value = await authorize(*args, **kwargs)
        admitted.set()
        await asyncio.wait_for(release.wait(), 15)
        return value

    source.authorize_bundle_for_save = held_authorize
    async with sessions() as a, sessions() as b, sessions() as observer:
        pid = await b.scalar(text("SELECT pg_backend_pid()"))
        reserve = asyncio.create_task(service.reserve_upload(a, 1, request))
        await asyncio.wait_for(admitted.wait(), 15)

        async def delete_revision():
            await b.execute(update(Score).values(head_revision_id=None))
            await b.execute(
                delete(ScoreRevision).where(ScoreRevision.id == postgres_bundle[1].test_revision_id)
            )

        deletion = asyncio.create_task(delete_revision())
        try:

            async def wait_for_row_lock():
                while (
                    await observer.scalar(
                        text("SELECT wait_event_type FROM pg_stat_activity WHERE pid = :pid"),
                        {"pid": pid},
                    )
                    != "Lock"
                ):
                    await observer.commit()
                    await asyncio.sleep(0.01)

            await asyncio.wait_for(wait_for_row_lock(), 15)
            assert not deletion.done()
        finally:
            release.set()
        result = await asyncio.wait_for(reserve, 15)
        await asyncio.wait_for(deletion, 15)
        await b.commit()
        row = (await b.execute(select(PracticeBundleRecord))).scalar_one()
        from app.db.models import ScoreRevisionPracticeBinding

        assert await b.scalar(select(ScoreRevisionPracticeBinding)) is None
        reservation = (await b.execute(select(PerformanceTakeUploadReservation))).scalar_one()
        assert reservation.manifest.practice_bundle_id == row.bundle_id
        assert (
            result.manifest.practice_binding.bundle_id
            == row.bundle_id
            == request.practice_binding.bundle_id
        )
        assert (
            len(
                await b.run_sync(
                    lambda db: practice_bundle_retention.collect_unowned_ready(
                        db,
                    )
                )
            )
            == 2
        )
        assert await b.get(PracticeBundleRecord, row.id) is None


@pytest.mark.asyncio
@pytest.mark.parametrize("owner", ["reservation", "take"])
async def test_durable_score_coordinate_constraints_in_postgres(postgres_bundle, owner):
    from sqlalchemy import update
    from sqlalchemy.exc import IntegrityError

    sessions, source, storage, request = await setup_bundle(postgres_bundle)
    service = PerformanceTakeUploadService(storage=storage, practice_bundle_service=source)
    async with sessions() as db:
        accepted = await service.reserve_upload(db, 1, request)
        reservation = await service.repository.get_reservation_by_uuid(
            db, 1, accepted.reservation_id
        )
        if owner == "take":
            storage.put_bytes(
                key=reservation.staging_object_key, content=MEDIA, content_type="audio/webm"
            )
            await service.finalize_take(db, 1, accepted.reservation_id)
        await db.commit()
        invalid = [
            {"ticks_per_quarter": 0},
            {"ticks_per_quarter": -1},
            {"ticks_per_quarter": 2**53},
            {"scope_start_tick": -1},
            {"scope_start_tick": 2**53},
            {"scope_terminal_tick": 0},
            {"scope_terminal_tick": -1},
            {"scope_terminal_tick": 2**53},
            {"scope_start_tick": 114, "scope_terminal_tick": 113},
        ]
        for values in invalid:
            with pytest.raises(IntegrityError, match="score_coordinates"):
                async with db.begin_nested():
                    await db.execute(update(PerformanceTakeManifest).values(**values))
