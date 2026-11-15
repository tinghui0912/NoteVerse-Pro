"""Authoritative Take admission, rollback, and persisted-lineage recovery on PostgreSQL."""

from dataclasses import replace
from datetime import timedelta
from unittest.mock import patch
import pytest
from sqlalchemy import select, func, event
from sqlalchemy.orm import Session
from sqlalchemy.exc import DBAPIError
from app.core.exceptions import (
    ExternalServiceException,
    ResourceNotFoundException,
    ValidationException,
)
from app.db.models import PerformanceTake, StoredObject, StorageUsageAccount, StoredObjectRetirement
from app.modules.performance_takes.finalization import PerformanceTakeFinalizationService
from app.modules.performance_takes.upload_reservation.reservation_service import (
    PerformanceTakeReservationService,
)
from app.modules.performance_takes.upload_reservation import effects, recovery
from app.modules.performance_takes.upload_reservation.persistence import (
    lifecycle_from_row,
    apply_transition,
)
from app.modules.performance_takes.manifest_persistence import manifest_from_row
from app.modules.performance_takes.upload_reservation.domain import (
    FinalizeLease,
    ReservationTransitionError,
    UNKNOWN_OUTCOME_GRACE,
)
from app.modules.storage_usage.service import StorageUsageService
from app.shared.time import utc_now
from tests.test_upload_reservation_postgres import setup_bundle, MEDIA

pytest_plugins = ["tests.test_practice_bundle_postgres"]


def finalize_in_session(sessions, service, reservation_id):
    with sessions() as db:
        return service.finalize_take(db, 1, reservation_id)


def setup(postgres_bundle):
    sessions, source, storage, request = setup_bundle(postgres_bundle)
    usage = StorageUsageService()
    reservations = PerformanceTakeReservationService(
        storage=storage, practice_bundle_service=source, storage_usage_service=usage
    )
    finalization = PerformanceTakeFinalizationService(
        repository=reservations.repository, storage=storage, storage_usage_service=usage
    )
    with sessions() as db:
        accepted = reservations.reserve_upload(db, 1, request)
        row = reservations.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
        manifest = manifest_from_row(row.manifest)
        key = row.staging_object_key
        storage.put_bytes(key=key, content=MEDIA, content_type="audio/webm")
    return sessions, reservations, finalization, storage, request, accepted, manifest, key


@pytest.mark.asyncio
@pytest.mark.parametrize("stage", ["object", "take", "complete", "quota"])
async def test_precommit_failure_preserves_manifest_quota_and_immediate_cleanup_evidence(
    postgres_bundle, stage
):
    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )

    def fail():
        raise RuntimeError("admission interrupted")

    with sessions() as db:

        def create_take(*args, **kwargs):
            value = original_create(*args, **kwargs)
            if stage == "take":
                fail()
            return value

        def quota(*args, **kwargs):
            original_quota(*args, **kwargs)
            if stage == "quota":
                fail()

        def transition(*args, **kwargs):
            original_transition(*args, **kwargs)
            if stage == "complete" and args[1].after.status.value == "COMPLETED":
                fail()

        def after_flush(sync, context):
            if stage == "object" and any(
                isinstance(item, StoredObject) and item.object_key.startswith("performance-takes/")
                for item in sync.new
            ):
                fail()

        original_create = service.repository.create_take
        original_quota = service.writer.storage_usage_service.commit_reservation
        original_transition = effects.apply_transition
        event.listen(db, "after_flush", after_flush)
        with (
            patch.object(service.repository, "create_take", side_effect=create_take),
            patch.object(
                service.writer.storage_usage_service, "commit_reservation", side_effect=quota
            ),
            patch.object(effects, "apply_transition", side_effect=transition),
        ):
            with pytest.raises(RuntimeError, match="admission interrupted"):
                service.finalize_take(db, 1, accepted.reservation_id)
    with sessions() as observer:
        row = reservations.repository.get_reservation_by_uuid(observer, 1, accepted.reservation_id)
        assert row.status == "RESERVED" and row.finalizing_token is None
        assert manifest_from_row(row.manifest) == manifest
        assert observer.scalar(select(func.count()).select_from(PerformanceTake)) == 0
        assert not (
            observer.scalars(
                select(StoredObject).where(StoredObject.object_key.like("performance-takes/%"))
            )
        ).all()
        account = observer.get(StorageUsageAccount, 1)
        assert account.used_bytes == 0 and account.reserved_bytes == len(MEDIA)
        candidates = lifecycle_from_row(row).orphan_candidates
        assert len(candidates) == 1 and storage.exists(candidates[0].key)
        assert candidates[0].remove_after <= utc_now()


@pytest.mark.parametrize("failure", ["missing", "size", "mime", "signature", "copy"])
def test_known_failure_recovers_immediately_and_preserves_upload_hold(postgres_bundle, failure):
    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    if failure == "missing":
        storage.delete(key)
    elif failure == "size":
        storage.put_bytes(key=key, content=MEDIA + b"!", content_type="audio/webm")
    elif failure == "mime":
        storage.put_bytes(key=key, content=MEDIA, content_type="audio/ogg")
    elif failure == "signature":
        storage.put_bytes(key=key, content=b"x" * len(MEDIA), content_type="audio/webm")
    with sessions() as db:
        with (
            patch.object(storage, "copy", side_effect=RuntimeError("copy failed"))
            if failure == "copy"
            else patch.object(storage, "copy", wraps=storage.copy)
        ):
            with pytest.raises((ValidationException, ResourceNotFoundException, RuntimeError)):
                service.finalize_take(db, 1, accepted.reservation_id)
        replay = reservations.reserve_upload(db, 1, request)
        assert replay.status == "RESERVED" and replay.upload_target is not None
        row = reservations.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
        assert manifest_from_row(row.manifest) == manifest
        assert row.finalizing_token is None
        assert all(
            item.remove_after <= utc_now() for item in lifecycle_from_row(row).orphan_candidates
        )
        assert (db.get(StorageUsageAccount, 1)).reserved_bytes == len(MEDIA)
        storage.put_bytes(key=key, content=MEDIA, content_type="audio/webm")
        take = service.finalize_take(db, 1, accepted.reservation_id)
        assert take.take_id == accepted.take_id


@pytest.mark.parametrize("committed", [False, True])
def test_unknown_commit_outcome_reads_fresh_postgres_lineage(postgres_bundle, committed):
    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )

    class LostAcknowledgement(Session):
        lost = False

        def commit(self):
            if not self.lost and any(
                getattr(item, "status", None) == "COMPLETED" for item in self.identity_map.values()
            ):
                self.lost = True
                if committed:
                    super().commit()
                raise DBAPIError.instance(
                    "COMMIT",
                    {},
                    Exception("connection closed"),
                    Exception,
                    connection_invalidated=True,
                )
            super().commit()

    with patch.object(recovery, "SessionLocal", sessions):
        with LostAcknowledgement(postgres_bundle[0], expire_on_commit=False) as db:
            with pytest.raises(ExternalServiceException):
                service.finalize_take(db, 1, accepted.reservation_id)
    with sessions() as db:
        row = reservations.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
        assert row.status == ("COMPLETED" if committed else "RESERVED")
        if not committed:
            orphan = lifecycle_from_row(row).orphan_candidates[0]
            assert orphan.remove_after > utc_now() + UNKNOWN_OUTCOME_GRACE - timedelta(seconds=10)
            assert storage.exists(orphan.key)
        take = service.finalize_take(db, 1, accepted.reservation_id)
        assert take.take_id == accepted.take_id
        assert db.scalar(select(func.count()).select_from(PerformanceTake)) == 1
        assert (db.get(StorageUsageAccount, 1)).used_bytes == len(MEDIA)


def test_writer_participates_without_commit_and_rejects_stale_evidence(postgres_bundle):
    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    now = utc_now()
    lease = FinalizeLease("a", "performance-takes/a.webm", now + timedelta(minutes=15))
    with sessions() as db:
        row = reservations.repository.get_reservation_by_uuid(
            db, 1, accepted.reservation_id, lock=True
        )
        apply_transition(row, lifecycle_from_row(row).begin_finalize(lease=lease, now=now), now=now)
        db.commit()
        candidate = service.media.verify(manifest, lease, key)
        # A stale capability cannot declare the current owner's candidate abandoned.
        service.recovery.recover(
            db,
            user_id=1,
            take_uuid=manifest.take_uuid,
            lease=replace(lease, token="stale"),
            unknown_outcome=False,
        )
        db.commit()
        row = reservations.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
        assert lifecycle_from_row(row).lease == lease
        assert lifecycle_from_row(row).orphan_candidates == ()
        with pytest.raises(ReservationTransitionError):
            service.writer.adopt(
                db,
                user_id=1,
                reservation_id=accepted.reservation_id,
                manifest=manifest,
                candidate=replace(candidate, lease=replace(lease, token="stale")),
            )
        db.rollback()
        with pytest.raises(ValidationException):
            service.writer.adopt(
                db,
                user_id=1,
                reservation_id=accepted.reservation_id,
                manifest=manifest,
                candidate=replace(candidate, manifest_sha256="0" * 64),
            )
        db.rollback()
        changed = replace(
            manifest,
            snapshot=manifest.snapshot.model_copy(
                update={"score_title_snapshot": "different snapshot"}
            ),
        )
        with pytest.raises(ValidationException):
            service.writer.adopt(
                db,
                user_id=1,
                reservation_id=accepted.reservation_id,
                manifest=changed,
                candidate=candidate,
            )
        db.rollback()
        with pytest.raises(ValidationException):
            service.writer.adopt(
                db,
                user_id=1,
                reservation_id=accepted.reservation_id,
                manifest=manifest,
                candidate=replace(
                    candidate,
                    object_facts=replace(candidate.object_facts, object_key="different candidate"),
                ),
            )
        db.rollback()
        service.writer.adopt(
            db,
            user_id=1,
            reservation_id=accepted.reservation_id,
            manifest=manifest,
            candidate=candidate,
        )
        with sessions() as observer:
            assert observer.scalar(select(PerformanceTake)) is None
        db.rollback()
    with sessions() as observer:
        row = reservations.repository.get_reservation_by_uuid(observer, 1, accepted.reservation_id)
        assert row.status == "FINALIZING" and row.finalizing_token == lease.token
        assert observer.scalar(select(PerformanceTake)) is None
        assert (observer.get(StorageUsageAccount, 1)).reserved_bytes == len(MEDIA)


@pytest.mark.asyncio
async def test_completed_deleted_resource_replay_cannot_resurrect_take(postgres_bundle):
    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    with sessions() as db:
        take = service.finalize_take(db, 1, accepted.reservation_id)
        service.takes.delete_take(db, 1, take.take_id)
        for command in [
            lambda: reservations.reserve_upload(db, 1, request),
            lambda: service.finalize_take(db, 1, accepted.reservation_id),
        ]:
            with pytest.raises(ResourceNotFoundException):
                command()
            db.rollback()
        assert db.scalar(select(PerformanceTake)) is None
        row = reservations.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
        assert row.status == "COMPLETED" and manifest_from_row(row.manifest) == manifest
        assert (db.get(StorageUsageAccount, 1)).used_bytes == 0
        assert db.scalar(select(StoredObjectRetirement)) is not None


@pytest.mark.asyncio
async def test_delete_after_finalize_visibility_has_one_serial_accounting_outcome(postgres_bundle):
    import asyncio

    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    visible, deleted = __import__("threading").Event(), __import__("threading").Event()
    hydrate = service.takes.get_take

    def read_after_delete(*args, **kwargs):
        visible.set()
        assert deleted.wait(10)
        return hydrate(*args, **kwargs)

    with sessions(), sessions() as delete_db:
        with patch.object(service.takes, "get_take", side_effect=read_after_delete):
            pending = asyncio.create_task(
                asyncio.to_thread(finalize_in_session, sessions, service, accepted.reservation_id)
            )
            try:
                assert await asyncio.to_thread(visible.wait, 10)
                service.takes.delete_take(delete_db, 1, accepted.take_id)
            finally:
                deleted.set()
            # Deletion may win before response hydration; it never reverses completion lineage.
            with pytest.raises(ResourceNotFoundException):
                await asyncio.wait_for(pending, 10)
    with sessions() as observer:
        assert observer.scalar(select(PerformanceTake)) is None
        row = reservations.repository.get_reservation_by_uuid(observer, 1, accepted.reservation_id)
        assert row.status == "COMPLETED"
        account = observer.get(StorageUsageAccount, 1)
        assert account.used_bytes == account.reserved_bytes == 0
        retirement = observer.scalar(select(StoredObjectRetirement))
        assert retirement is not None
        assert storage.exists(retirement.object_key)


def test_known_failure_after_reservation_expiry_releases_hold(postgres_bundle):
    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )

    def expired_media(*args):
        with sessions() as other:
            row = reservations.repository.get_reservation_by_uuid(
                other, 1, accepted.reservation_id, lock=True
            )
            # Time advances while physical verification is in flight.
            row.expires_at = utc_now() - timedelta(seconds=1)
            other.commit()
        raise ValidationException("validation_error", field="media_byte_size")

    with sessions() as db:
        with patch.object(service.media, "verify", side_effect=expired_media):
            with pytest.raises(ValidationException):
                service.finalize_take(db, 1, accepted.reservation_id)
        row = reservations.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
        assert row.status == "EXPIRED" and row.finalizing_token is None
        account = db.get(StorageUsageAccount, 1)
        assert account.used_bytes == account.reserved_bytes == 0


def test_late_io_records_orphan_after_winner_even_if_prior_cleanup_saw_absence(
    postgres_bundle,
):
    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    with sessions() as db:
        service.finalize_take(db, 1, accepted.reservation_id)
        late = FinalizeLease(
            "old", "performance-takes/late-old.webm", utc_now() - timedelta(hours=1)
        )
        storage.copy(key, late.object_key)
        service.recovery.recover(
            db, user_id=1, take_uuid=accepted.take_id, lease=late, unknown_outcome=False
        )
        db.commit()
        row = reservations.repository.get_reservation_by_uuid(db, 1, accepted.reservation_id)
        assert row.status == "COMPLETED"
        assert late.object_key in {item.key for item in lifecycle_from_row(row).orphan_candidates}
        winner = reservations.repository.get_by_reservation(db, 1, row.id)
        assert winner.recording_object.object_key != late.object_key
        assert (db.get(StorageUsageAccount, 1)).used_bytes == len(MEDIA)


@pytest.mark.asyncio
async def test_independent_retry_can_complete_while_known_failure_returns(postgres_bundle):
    import asyncio

    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    recovered, release = __import__("threading").Event(), __import__("threading").Event()

    class RecoveringSession(Session):
        def commit(self):
            is_recovery = any(
                getattr(item, "status", None) == "RESERVED"
                and getattr(item, "orphan_final_object_keys", "[]") != "[]"
                for item in self.identity_map.values()
            )
            super().commit()
            if is_recovery:
                recovered.set()
                assert release.wait(10)

    verify = service.media.verify
    first = True

    def fail_first(*args, **kwargs):
        nonlocal first
        if first:
            first = False
            raise ValidationException("validation_error", field="media_byte_size")
        return verify(*args, **kwargs)

    with RecoveringSession(postgres_bundle[0], expire_on_commit=False), sessions() as b:
        with patch.object(service.media, "verify", side_effect=fail_first):

            def failing_attempt():
                with RecoveringSession(postgres_bundle[0], expire_on_commit=False) as db:
                    return service.finalize_take(db, 1, accepted.reservation_id)

            failing = asyncio.create_task(asyncio.to_thread(failing_attempt))
            try:
                await asyncio.to_thread(recovered.wait, 10)
                replay = reservations.reserve_upload(b, 1, request)
                assert replay.status == "RESERVED" and replay.manifest == manifest.snapshot
                assert (b.get(StorageUsageAccount, 1)).reserved_bytes == len(MEDIA)
                saved = service.finalize_take(b, 1, accepted.reservation_id)
                assert saved.take_id == accepted.take_id
            finally:
                release.set()
            with pytest.raises(ValidationException):
                await asyncio.wait_for(failing, 10)
    with sessions() as observer:
        row = reservations.repository.get_reservation_by_uuid(observer, 1, accepted.reservation_id)
        assert row.status == "COMPLETED"
        assert observer.scalar(select(func.count()).select_from(PerformanceTake)) == 1
        account = observer.get(StorageUsageAccount, 1)
        assert account.used_bytes == len(MEDIA) and account.reserved_bytes == 0


@pytest.mark.asyncio
async def test_late_candidate_cannot_adopt_or_recover_new_inflight_lease(postgres_bundle):
    import asyncio
    from threading import Event

    sessions, reservations, service, storage, request, accepted, manifest, key = setup(
        postgres_bundle
    )
    entered = [Event(), Event()]
    release = [Event(), Event()]
    candidates = []
    original_copy = storage.copy

    def held_copy(source, target):
        index = len(candidates)
        candidates.append(target)
        original_copy(source, target)
        entered[index].set()
        assert release[index].wait(15), "candidate IO was not released"

    with sessions(), sessions(), sessions() as observer:
        with patch.object(storage, "copy", side_effect=held_copy):
            first = asyncio.create_task(
                asyncio.to_thread(finalize_in_session, sessions, service, accepted.reservation_id)
            )
            second = None
            try:
                assert await asyncio.to_thread(entered[0].wait, 10)
                row = reservations.repository.get_reservation_by_uuid(
                    observer, 1, accepted.reservation_id, lock=True
                )
                lease_a = lifecycle_from_row(row).lease
                row.finalizing_expires_at = utc_now() - timedelta(seconds=1)
                observer.commit()
                second = asyncio.create_task(
                    asyncio.to_thread(
                        finalize_in_session, sessions, service, accepted.reservation_id
                    )
                )
                assert await asyncio.to_thread(entered[1].wait, 10)
                row = reservations.repository.get_reservation_by_uuid(
                    observer, 1, accepted.reservation_id
                )
                lease_b = lifecycle_from_row(row).lease
                assert lease_a.token != lease_b.token and lease_a.object_key != lease_b.object_key
                observer.commit()
                release[0].set()
                with pytest.raises(ValidationException):
                    await asyncio.wait_for(first, 10)
                row = reservations.repository.get_reservation_by_uuid(
                    observer, 1, accepted.reservation_id
                )
                assert row.status == "FINALIZING" and lifecycle_from_row(row).lease == lease_b
                assert observer.scalar(select(PerformanceTake)) is None
                assert (
                    observer.scalar(
                        select(StoredObject).where(StoredObject.object_key == candidates[0])
                    )
                    is None
                )
                account = observer.get(StorageUsageAccount, 1)
                assert account.used_bytes == 0 and account.reserved_bytes == len(MEDIA)
                assert candidates[0] in {
                    item.key for item in lifecycle_from_row(row).orphan_candidates
                }
                observer.commit()
                release[1].set()
                assert (await asyncio.wait_for(second, 10)).take_id == accepted.take_id
            finally:
                for barrier in release:
                    barrier.set()
                await asyncio.gather(
                    *[task for task in [first, second] if task is not None], return_exceptions=True
                )
    with sessions() as observer:
        take = observer.scalar(select(PerformanceTake))
        observer.refresh(take, attribute_names=["recording_object"])
        assert take.recording_object.object_key == candidates[1]
        assert observer.scalar(select(func.count()).select_from(PerformanceTake)) == 1
