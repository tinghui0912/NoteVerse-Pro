"""Upload reservation ownership across independent PostgreSQL transactions."""

from __future__ import annotations

import asyncio
from datetime import timedelta
from threading import Event
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import async_sessionmaker

from app.core.exceptions import ValidationException
from app.db.models import User, StorageUsageAccount, StorageUsageCounter, StorageUsageCategory
from app.db.models.performance_take import PerformanceTake
from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from app.db.models.storage_usage import StorageUsageReservation
from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.performance_takes.schemas import PerformanceTakeUploadReservationRequest
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.practice.source.service import PracticeSourceService
from app.storage.base import DirectUploadTarget
from app.utils.timezone import utc_now_naive

pytest_plugins = ["tests.test_practice_source_postgres"]

MEDIA = b"\x1a\x45\xdf\xa3" + b"reserved-recording"


async def setup_source(postgres_source):
    engine, repository, bundle, storage = postgres_source
    sessions = async_sessionmaker(engine, expire_on_commit=False)
    async with sessions() as db:
        db.add(
            User(id=1, email="reserve@example.com", display_name="Reserve", password_hash="test")
        )
        await db.flush()
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
        snapshot = await repository.materialize(db, bundle)
    source = PracticeSourceService(repository=repository, storage=storage)
    source.pin_source = AsyncMock(
        return_value=SimpleNamespace(
            snapshot=snapshot,
            score_db_id=None,
            revision_db_id=None,
            score_id=bundle.score_id,
            revision_id=bundle.revision_id,
            score_title="Reserved score",
        )
    )
    storage.upload_url = lambda **kwargs: DirectUploadTarget(
        upload_url="https://upload.example/target", upload_method="PUT", upload_headers={}
    )
    request = PerformanceTakeUploadReservationRequest.model_validate(
        {
            "client_request_id": "same-request",
            "source": {
                "score_id": bundle.score_id,
                "revision_id": bundle.revision_id,
                "artifact_id": bundle.artifact.artifact_id,
            },
            "media": {
                "kind": "AUDIO",
                "mime_type": "audio/webm",
                "byte_size": len(MEDIA),
                "duration_ms": 1000,
            },
            "scope": {"kind": "FULL", "start_beat": 0, "terminal_beat": 4},
            "tempo_plan": {
                "selection": {"mode": "SCORE"},
                "segments": [{"startBeat": 0, "bpm": 120, "source": "MUSICXML"}],
            },
            "recording_timebase": {
                "nominalMediaDurationMs": 1000,
                "activeSegments": [
                    {"perfStartMs": 0, "perfEndMs": 1000, "mediaStartMs": 0, "mediaEndMs": 1000}
                ],
            },
        }
    )
    return sessions, source, storage, request


@pytest.mark.asyncio
async def test_two_creators_share_one_reservation_and_one_quota_hold(postgres_source):
    sessions, source, storage, request = await setup_source(postgres_source)
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

    service = PerformanceTakeService(
        repository=SynchronizedRepository(), storage=storage, practice_source_service=source
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
        assert await db.scalar(select(func.count()).select_from(StorageUsageReservation)) == 1
        account = await db.get(StorageUsageAccount, 1)
        assert account.reserved_bytes == len(MEDIA) and account.used_bytes == 0


@pytest.mark.parametrize("takeover", [False, True])
@pytest.mark.asyncio
async def test_finalize_lease_blocks_concurrency_and_expired_takeover_preserves_one_take(
    postgres_source, takeover
):
    sessions, source, storage, request = await setup_source(postgres_source)
    service = PerformanceTakeService(storage=storage, practice_source_service=source)
    async with sessions() as a:
        reserved = await service.reserve_upload(a, 1, request)
        row = await service.repository.get_reservation_by_uuid(a, 1, reserved.reservation_id)
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
        assert take.take_uuid == reserved.take_id and row.status == "COMPLETED"
        assert row.reservation_uuid != row.storage_reservation_id
        assert storage.read_bytes(take.media_object_key) == MEDIA
        if takeover:
            assert candidates[0] in row.orphan_final_object_keys
            assert candidates[0] != take.media_object_key
        account = await db.get(StorageUsageAccount, 1)
        assert account.used_bytes == len(MEDIA) and account.reserved_bytes == 0
