"""Unacknowledged semantic COMMIT is resolved only by a fresh PostgreSQL session."""

import asyncio
from datetime import timedelta
from contextlib import contextmanager
from unittest.mock import patch

import pytest
from sqlalchemy import func, select
from sqlalchemy.exc import DBAPIError, OperationalError
from sqlalchemy.orm import Session

from app.core.exceptions import ExternalServiceException
from app.db.models import PerformanceTake, StoredObject, StorageUsageAccount
from app.modules.performance_takes.upload_reservation import recovery
from app.modules.performance_takes.upload_reservation.domain import UNKNOWN_OUTCOME_GRACE
from app.modules.performance_takes.upload_reservation.persistence import lifecycle_from_row
from app.modules.performance_takes.manifest_persistence import manifest_from_row
from app.shared.time import utc_now
from tests.test_performance_take_finalization_postgres import setup
from tests.test_upload_reservation_postgres import MEDIA

pytest_plugins = ["tests.test_practice_bundle_postgres"]


class UncertainRequestSession(Session):
    uncertain = False

    def execute(self, *args, **kwargs):
        assert not self.uncertain, "Request-session queries cannot decide an unknown COMMIT"
        return super().execute(*args, **kwargs)

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


def assert_persisted_outcome(db, reservations, accepted, manifest, candidate, committed):
    row = reservations.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
    assert row.status == ("COMPLETED" if committed else "RESERVED")
    assert row.finalizing_token is None
    assert manifest_from_row(row.manifest) == manifest
    account = db.get(StorageUsageAccount, 1)
    assert account.used_bytes == (len(MEDIA) if committed else 0)
    assert account.reserved_bytes == (0 if committed else len(MEDIA))
    assert db.scalar(select(func.count()).select_from(PerformanceTake)) == int(committed)
    assert db.scalar(
        select(func.count())
        .select_from(StoredObject)
        .where(StoredObject.object_key == candidate.object_facts.object_key)
    ) == int(committed)
    orphans = lifecycle_from_row(row).orphan_candidates
    if committed:
        assert orphans == ()
        take = reservations.repository.get_by_reservation(db, 1, row.id)
        assert take.recording_object.object_key == candidate.lease.object_key
    else:
        assert len(orphans) == 1 and orphans[0].key == candidate.lease.object_key
        assert utc_now() + UNKNOWN_OUTCOME_GRACE - timedelta(seconds=10) <= orphans[0].remove_after
        assert orphans[0].remove_after <= utc_now() + UNKNOWN_OUTCOME_GRACE


@pytest.mark.parametrize("committed", [False, True])
@pytest.mark.parametrize(
    "error_kind", ["runtime", "dbapi_noninvalidated", "operational", "timeout"]
)
def test_every_noninvalidated_commit_exception_reads_fresh_lineage(
    postgres_bundle, committed, error_kind
):
    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    candidates = []
    opened = []
    verify = service.media.verify

    def capture(*args):
        candidate = verify(*args)
        candidates.append(candidate)
        return candidate

    class LostAcknowledgement(UncertainRequestSession):
        def commit(self):
            if self.completing():
                if committed:
                    super().commit()
                self.uncertain = True
                raise commit_error(error_kind)
            super().commit()

    @contextmanager
    def fresh_session():
        with sessions() as db:
            opened.append(db)
            yield db

    with (
        patch.object(recovery, "SessionLocal", fresh_session),
        patch.object(service.media, "verify", side_effect=capture),
    ):
        with LostAcknowledgement(postgres_bundle[0], expire_on_commit=False) as request_db:
            with pytest.raises(ExternalServiceException) as failure:
                service.finalize_take(request_db, 1, accepted.reservation_id)
            assert failure.value.details == {
                "service": "database",
                "retryable": True,
                "operation": "performance_take_finalize",
            }
            assert request_db.uncertain
            assert len(opened) == 1 and opened[0] is not request_db
    assert len(candidates) == 1
    with sessions() as observer:
        assert_persisted_outcome(
            observer, reservations, accepted, manifest, candidates[0], committed
        )
        saved = service.finalize_take(observer, 1, accepted.reservation_id)
        replay = service.finalize_take(observer, 1, accepted.reservation_id)
        assert saved.take_id == replay.take_id == accepted.take_id
        assert observer.scalar(select(func.count()).select_from(PerformanceTake)) == 1
        row = reservations.repository.get_reservation_by_uuid(observer, 1, accepted.reservation_id)
        take = reservations.repository.get_by_reservation(observer, 1, row.id)
        assert (
            observer.scalar(
                select(func.count())
                .select_from(StoredObject)
                .where(StoredObject.object_key == take.recording_object.object_key)
            )
            == 1
        )
        account = observer.get(StorageUsageAccount, 1)
        observer.refresh(account)
        assert account.used_bytes == len(MEDIA) and account.reserved_bytes == 0
        assert storage.exists(candidates[0].lease.object_key)


@pytest.mark.parametrize("committed", [False, True])
def test_commit_cancellation_settles_fresh_lineage_before_propagation(postgres_bundle, committed):
    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    opened, candidates = [], []
    verified = service.media.verify

    def capture(*args):
        candidate = verified(*args)
        candidates.append(candidate)
        return candidate

    class InterruptedCommit(UncertainRequestSession):
        def commit(self):
            if self.completing():
                if committed:
                    super().commit()
                self.uncertain = True
                raise asyncio.CancelledError()
            super().commit()

    @contextmanager
    def fresh_session():
        with sessions() as db:
            opened.append(db)
            yield db

    with (
        patch.object(recovery, "SessionLocal", fresh_session),
        patch.object(service.media, "verify", side_effect=capture),
    ):
        with InterruptedCommit(postgres_bundle[0], expire_on_commit=False) as request_db:
            with pytest.raises(asyncio.CancelledError):
                service.finalize_take(request_db, 1, accepted.reservation_id)
            assert request_db.uncertain
            assert len(opened) == 1 and opened[0] is not request_db
            # Cancellation is propagated only after persisted lineage has converged.
            with sessions() as observer:
                assert_persisted_outcome(
                    observer, reservations, accepted, manifest, candidates[0], committed
                )
    with sessions() as observer:
        saved = service.finalize_take(observer, 1, accepted.reservation_id)
        assert saved.take_id == accepted.take_id
        assert observer.scalar(select(func.count()).select_from(PerformanceTake)) == 1
        account = observer.get(StorageUsageAccount, 1)
        assert account.used_bytes == len(MEDIA) and account.reserved_bytes == 0
