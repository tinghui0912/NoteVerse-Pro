"""Concrete Take command idempotency, capacity and transport binding on PostgreSQL."""

from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from sqlalchemy import select, func
from sqlalchemy.orm import sessionmaker
from app.composition import storage_resources as _resource_wiring
from app.composition import media_resources as wiring
from app.db.models import (
    StoragePlanPolicy,
    UserStorageEntitlement,
    StorageUsageAccount,
    StorageUsageCounter,
    PerformanceTakeUploadReservation,
    UploadSession,
    StorageQuotaHold,
)
from app.modules.storage_governance.usage.domain import StorageUsageCategory
from app.modules.performance_takes.schemas import PerformanceTakeUploadReservationRequest
from app.modules.practice.bundle.service import PracticeBundleService
from tests.support.practice_bundle import bind_bundle

pytest_plugins = ["tests.test_practice_bundle_postgres"]
MEDIA = b"\x1aE\xdf\xa3recording"


def setup_bundle(postgres_bundle):
    engine, repository, bundle, storage = postgres_bundle
    sessions = sessionmaker(engine, expire_on_commit=False)
    with sessions() as db:
        if db.get(StoragePlanPolicy, "FREE") is None:
            db.add(StoragePlanPolicy(plan_code="FREE", default_limit_bytes=1048576))
            db.flush()
        db.add(UserStorageEntitlement(user_id=1, plan_code="FREE"))
        db.add(
            StorageUsageAccount(
                user_id=1,
                used_bytes=0,
            )
        )
        db.add(StorageUsageCounter(user_id=1, category=StorageUsageCategory.UPLOAD, used_bytes=0))
        db.commit()
        reference, verified_bundle = bind_bundle(
            db, storage, bundle, revision_id=repository.test_revision_id
        )
    source = PracticeBundleService(
        repository=repository, writes=_resource_wiring.build_object_write_coordinator(storage)
    )
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


def test_two_creators_share_one_reservation_session_and_hold(postgres_bundle):
    sessions, source, storage, request = setup_bundle(postgres_bundle)
    barrier = Barrier(2)

    def reserve():
        with sessions() as db:
            barrier.wait(10)
            return wiring.build_take_reservation_service(storage).reserve_upload(db, 1, request)

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: reserve(), range(2)))
    assert results[0].reservation_id == results[1].reservation_id
    assert results[0].upload_session.session_id == results[1].upload_session.session_id
    with sessions() as db:
        for model in (PerformanceTakeUploadReservation, UploadSession, StorageQuotaHold):
            assert db.scalar(select(func.count()).select_from(model)) == 1
