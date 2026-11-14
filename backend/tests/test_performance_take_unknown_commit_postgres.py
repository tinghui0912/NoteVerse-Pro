"""Unacknowledged semantic COMMIT is resolved only by a fresh PostgreSQL session."""

import asyncio
from datetime import timedelta
from contextlib import asynccontextmanager
from unittest.mock import patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ExternalServiceException
from app.db.models import PerformanceTake, StoredObject, StorageUsageAccount
from app.modules.performance_takes.upload_reservation import recovery
from app.modules.performance_takes.upload_reservation.domain import UNKNOWN_OUTCOME_GRACE
from app.modules.performance_takes.upload_reservation.persistence import lifecycle_from_row
from app.modules.performance_takes.manifest_persistence import manifest_from_row
from app.utils.timezone import utc_now_naive
from tests.test_performance_take_finalization_postgres import setup
from tests.test_upload_reservation_postgres import MEDIA

pytest_plugins = ["tests.test_practice_bundle_postgres"]


class UncertainRequestSession(AsyncSession):
    uncertain = False

    async def execute(self, *args, **kwargs):
        assert not self.uncertain, "Request-session queries cannot decide an unknown COMMIT"
        return await super().execute(*args, **kwargs)

    def completing(self):
        assert not self.uncertain, "Uncertain request session cannot commit recovery"
        return any(
            getattr(row, "status", None) == "COMPLETED" for row in self.identity_map.values()
        )


def commit_error(kind):
    if kind == "runtime":
        return RuntimeError("lost COMMIT acknowledgement")
    if kind == "timeout":
        return TimeoutError("COMMIT acknowledgement timed out")
    if kind == "operational":
        return OperationalError(
            "COMMIT", {}, Exception("transport failed"), connection_invalidated=False
        )
    return DBAPIError.instance(
        "COMMIT", {}, Exception("transport failed"), Exception, connection_invalidated=False
    )


async def assert_persisted_outcome(db, reservations, accepted, manifest, candidate, committed):
    row = await reservations.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
    assert row.status == ("COMPLETED" if committed else "RESERVED")
    assert row.finalizing_token is None
    assert manifest_from_row(row.manifest) == manifest
    account = await db.get(StorageUsageAccount, 1)
    assert account.used_bytes == (len(MEDIA) if committed else 0)
    assert account.reserved_bytes == (0 if committed else len(MEDIA))
    assert await db.scalar(select(func.count()).select_from(PerformanceTake)) == int(committed)
    assert await db.scalar(
        select(func.count())
        .select_from(StoredObject)
        .where(StoredObject.object_key == candidate.object_facts.object_key)
    ) == int(committed)
    orphans = lifecycle_from_row(row).orphan_candidates
    if committed:
        assert orphans == ()
        take = await reservations.repository.get_by_reservation(db, 1, row.id)
        assert take.recording_object.object_key == candidate.lease.object_key
    else:
        assert len(orphans) == 1 and orphans[0].key == candidate.lease.object_key
        assert (
            utc_now_naive() + UNKNOWN_OUTCOME_GRACE - timedelta(seconds=10)
            <= orphans[0].remove_after
        )
        assert orphans[0].remove_after <= utc_now_naive() + UNKNOWN_OUTCOME_GRACE


@pytest.mark.asyncio
@pytest.mark.parametrize("committed", [False, True])
@pytest.mark.parametrize(
    "error_kind", ["runtime", "dbapi_noninvalidated", "operational", "timeout"]
)
async def test_every_noninvalidated_commit_exception_reads_fresh_lineage(
    postgres_bundle, committed, error_kind
):
    sessions, reservations, service, storage, request, accepted, manifest, key = await setup(
        postgres_bundle
    )
    candidates = []
    opened = []
    verify = service.media.verify

    async def capture(*args):
        candidate = await verify(*args)
        candidates.append(candidate)
        return candidate

    class LostAcknowledgement(UncertainRequestSession):
        async def commit(self):
            if self.completing():
                if committed:
                    await super().commit()
                self.uncertain = True
                raise commit_error(error_kind)
            await super().commit()

    @asynccontextmanager
    async def fresh_session():
        async with sessions() as db:
            opened.append(db)
            yield db

    with (
        patch.object(recovery, "AsyncSessionLocal", fresh_session),
        patch.object(service.media, "verify", side_effect=capture),
    ):
        async with LostAcknowledgement(postgres_bundle[0], expire_on_commit=False) as request_db:
            with pytest.raises(ExternalServiceException) as failure:
                await service.finalize_take(request_db, 1, accepted.reservation_id)
            assert failure.value.details == {
                "service": "database",
                "retryable": True,
                "operation": "performance_take_finalize",
            }
            assert request_db.uncertain
            assert len(opened) == 1 and opened[0] is not request_db
    assert len(candidates) == 1
    async with sessions() as observer:
        await assert_persisted_outcome(
            observer, reservations, accepted, manifest, candidates[0], committed
        )
        saved = await service.finalize_take(observer, 1, accepted.reservation_id)
        replay = await service.finalize_take(observer, 1, accepted.reservation_id)
        assert saved.take_id == replay.take_id == accepted.take_id
        assert await observer.scalar(select(func.count()).select_from(PerformanceTake)) == 1
        row = await reservations.repository.get_reservation_by_uuid(
            observer, 1, accepted.reservation_id
        )
        take = await reservations.repository.get_by_reservation(observer, 1, row.id)
        assert (
            await observer.scalar(
                select(func.count())
                .select_from(StoredObject)
                .where(StoredObject.object_key == take.recording_object.object_key)
            )
            == 1
        )
        account = await observer.get(StorageUsageAccount, 1)
        await observer.refresh(account)
        assert account.used_bytes == len(MEDIA) and account.reserved_bytes == 0
        assert storage.exists(candidates[0].lease.object_key)


@pytest.mark.asyncio
@pytest.mark.parametrize("committed", [False, True])
async def test_commit_cancellation_settles_fresh_lineage_before_propagation(
    postgres_bundle, committed
):
    sessions, reservations, service, storage, request, accepted, manifest, key = await setup(
        postgres_bundle
    )
    commit_entered = asyncio.Event()
    recovery_entered = asyncio.Event()
    allow_recovery = asyncio.Event()
    opened = []
    candidates = []
    verify = service.media.verify

    async def capture(*args):
        candidate = await verify(*args)
        candidates.append(candidate)
        return candidate

    class InterruptedCommit(UncertainRequestSession):
        async def commit(self):
            if self.completing():
                if committed:
                    await super().commit()
                self.uncertain = True
                commit_entered.set()
                await asyncio.Event().wait()  # Cancellation interrupts the COMMIT invocation.
            else:
                await super().commit()

    @asynccontextmanager
    async def fresh_session():
        async with sessions() as db:
            opened.append(db)
            recovery_entered.set()
            await allow_recovery.wait()
            yield db

    with (
        patch.object(recovery, "AsyncSessionLocal", fresh_session),
        patch.object(service.media, "verify", side_effect=capture),
    ):
        async with InterruptedCommit(postgres_bundle[0], expire_on_commit=False) as request_db:
            pending = asyncio.create_task(
                service.finalize_take(request_db, 1, accepted.reservation_id)
            )
            try:
                await asyncio.wait_for(commit_entered.wait(), 10)
                pending.cancel()
                await asyncio.wait_for(recovery_entered.wait(), 10)
                assert len(opened) == 1 and opened[0] is not request_db
                # Repeated cancellation cannot abandon the independent reconciliation task.
                pending.cancel()
                await asyncio.sleep(0)
                assert not pending.done()
                allow_recovery.set()
                with pytest.raises(asyncio.CancelledError):
                    await asyncio.wait_for(pending, 10)
            finally:
                allow_recovery.set()
                if not pending.done():
                    pending.cancel()
                await asyncio.gather(pending, return_exceptions=True)
    async with sessions() as observer:
        await assert_persisted_outcome(
            observer, reservations, accepted, manifest, candidates[0], committed
        )
        saved = await service.finalize_take(observer, 1, accepted.reservation_id)
        assert saved.take_id == accepted.take_id
        assert await observer.scalar(select(func.count()).select_from(PerformanceTake)) == 1
        account = await observer.get(StorageUsageAccount, 1)
        await observer.refresh(account)
        assert account.used_bytes == len(MEDIA) and account.reserved_bytes == 0
