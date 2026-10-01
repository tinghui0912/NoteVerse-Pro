from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    PerformanceTake,
    PerformanceTakeUploadAuthorization,
    PerformanceTakeUploadAuthorizationStatus,
    PracticeSourceSnapshot,
    PracticeSourceSnapshotDeleteOutbox,
    PracticeSourceSnapshotDeleteOutboxStatus,
)
from app.modules.async_operations.delivery_policy import (
    delivery_lease_expired,
    exponential_retry_delay_seconds,
)
from app.utils.timezone import utc_now_naive


def _status_value(status: object) -> str:
    value = getattr(status, "value", status)
    return str(value)


TERMINAL_AUTH_STATUSES = {
    PerformanceTakeUploadAuthorizationStatus.ARCHIVED.value,
    PerformanceTakeUploadAuthorizationStatus.CANCELLED.value,
    PerformanceTakeUploadAuthorizationStatus.EXPIRED.value,
}


@dataclass(frozen=True)
class PracticeSourceSnapshotDeletePayload:
    outbox_uuid: str
    source_snapshot_id: int | None
    snapshot_uuid: str
    storage_backend: str
    prepared_musicxml_object_key: str
    artifact_object_key: str
    attempt: int
    max_attempts: int


class PracticeSourceSnapshotDeleteService:
    def active_reference_count(self, db: Session, snapshot_id: int) -> int:
        take_refs = db.execute(
            select(func.count(PerformanceTake.id)).where(
                PerformanceTake.source_snapshot_id == snapshot_id
            )
        ).scalar_one()
        auth_refs = db.execute(
            select(func.count(PerformanceTakeUploadAuthorization.id)).where(
                PerformanceTakeUploadAuthorization.source_snapshot_id == snapshot_id,
                PerformanceTakeUploadAuthorization.status.notin_(
                    list(TERMINAL_AUTH_STATUSES)
                ),
            )
        ).scalar_one()
        return int(take_refs) + int(auth_refs)

    def enqueue_if_unreferenced(
        self,
        db: Session,
        snapshot_id: int | None,
        *,
        storage_backend: str,
    ) -> PracticeSourceSnapshotDeleteOutbox | None:
        if snapshot_id is None:
            return None
        snapshot = db.get(PracticeSourceSnapshot, snapshot_id)
        if snapshot is None:
            return None
        if self.active_reference_count(db, snapshot_id) > 0:
            return None
        existing = db.execute(
            select(PracticeSourceSnapshotDeleteOutbox).where(
                PracticeSourceSnapshotDeleteOutbox.snapshot_uuid == snapshot.snapshot_uuid,
                PracticeSourceSnapshotDeleteOutbox.status
                != PracticeSourceSnapshotDeleteOutboxStatus.COMPLETED.value,
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        outbox = PracticeSourceSnapshotDeleteOutbox(
            source_snapshot_id=snapshot.id,
            snapshot_uuid=snapshot.snapshot_uuid,
            storage_backend=storage_backend,
            prepared_musicxml_object_key=snapshot.prepared_musicxml_object_key,
            artifact_object_key=snapshot.artifact_object_key,
            status=PracticeSourceSnapshotDeleteOutboxStatus.PENDING.value,
            max_attempts=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
        )
        db.add(outbox)
        db.flush()
        return outbox

    def claim(
        self,
        db: Session,
        outbox_uuid: str,
    ) -> PracticeSourceSnapshotDeletePayload | None:
        outbox = self._get(db, outbox_uuid, lock=True)
        if outbox is None or _status_value(outbox.status) in {
            PracticeSourceSnapshotDeleteOutboxStatus.PROCESSING.value,
            PracticeSourceSnapshotDeleteOutboxStatus.COMPLETED.value,
        }:
            return None
        if (
            _status_value(outbox.status)
            == PracticeSourceSnapshotDeleteOutboxStatus.FAILED.value
            and outbox.next_attempt_at > utc_now_naive()
        ):
            return None
        if outbox.attempt_count >= settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS:
            return None

        if outbox.source_snapshot_id is not None and self.active_reference_count(
            db, outbox.source_snapshot_id
        ) > 0:
            outbox.status = PracticeSourceSnapshotDeleteOutboxStatus.COMPLETED.value
            outbox.completed_at = utc_now_naive()
            outbox.last_error = None
            outbox.updated_at = utc_now_naive()
            return None

        attempt = outbox.attempt_count + 1
        payload = replace(
            self._build_payload(outbox),
            attempt=attempt,
            max_attempts=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
        )
        now = utc_now_naive()
        outbox.status = PracticeSourceSnapshotDeleteOutboxStatus.PROCESSING.value
        outbox.attempt_count += 1
        outbox.started_at = now
        outbox.updated_at = now
        return payload

    def complete(self, db: Session, outbox_uuid: str, *, attempt: int | None = None) -> bool:
        outbox = self._get(db, outbox_uuid, lock=True)
        if outbox is None:
            return False
        if _status_value(outbox.status) == PracticeSourceSnapshotDeleteOutboxStatus.COMPLETED.value:
            if attempt is not None and outbox.attempt_count != attempt:
                return False
            return True
        if _status_value(outbox.status) != PracticeSourceSnapshotDeleteOutboxStatus.PROCESSING.value:
            return False
        if attempt is not None and outbox.attempt_count != attempt:
            return False
        now = utc_now_naive()
        outbox.status = PracticeSourceSnapshotDeleteOutboxStatus.COMPLETED.value
        outbox.completed_at = now
        outbox.last_error = None
        outbox.updated_at = now
        return True

    def fail(
        self,
        db: Session,
        outbox_uuid: str,
        error: str,
        *,
        attempt: int | None = None,
    ) -> bool:
        outbox = self._get(db, outbox_uuid, lock=True)
        if outbox is None:
            return False
        if _status_value(outbox.status) != PracticeSourceSnapshotDeleteOutboxStatus.PROCESSING.value:
            return False
        if attempt is not None and outbox.attempt_count != attempt:
            return False
        delay = exponential_retry_delay_seconds(
            base_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_RETRY_BASE_SECONDS,
            attempt_count=outbox.attempt_count,
        )
        now = utc_now_naive()
        outbox.status = PracticeSourceSnapshotDeleteOutboxStatus.FAILED.value
        outbox.next_attempt_at = now + timedelta(seconds=delay)
        outbox.last_error = error[:4000]
        outbox.updated_at = now
        return True

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not self._is_dispatchable(outbox):
            return False
        now = utc_now_naive()
        outbox.status = PracticeSourceSnapshotDeleteOutboxStatus.DISPATCHED.value
        outbox.dispatched_at = now
        outbox.updated_at = now
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if (
            outbox is None
            or _status_value(outbox.status)
            != PracticeSourceSnapshotDeleteOutboxStatus.DISPATCHED.value
        ):
            return
        outbox.status = PracticeSourceSnapshotDeleteOutboxStatus.PENDING.value
        outbox.dispatched_at = None
        outbox.last_error = error[:4000]
        outbox.updated_at = utc_now_naive()

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        stale = db.execute(
            select(PracticeSourceSnapshotDeleteOutbox).where(
                or_(
                    PracticeSourceSnapshotDeleteOutbox.status
                    == PracticeSourceSnapshotDeleteOutboxStatus.DISPATCHED.value,
                    PracticeSourceSnapshotDeleteOutbox.status
                    == PracticeSourceSnapshotDeleteOutboxStatus.PROCESSING.value,
                )
            )
        ).scalars()
        for outbox in stale:
            if delivery_lease_expired(
                status=outbox.status,
                dispatched_status=PracticeSourceSnapshotDeleteOutboxStatus.DISPATCHED.value,
                processing_status=PracticeSourceSnapshotDeleteOutboxStatus.PROCESSING.value,
                dispatched_at=outbox.dispatched_at,
                started_at=outbox.started_at,
                now=now,
                dispatch_timeout_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_TIMEOUT_SECONDS,
                processing_timeout_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_PROCESSING_TIMEOUT_SECONDS,
            ):
                outbox.status = PracticeSourceSnapshotDeleteOutboxStatus.FAILED.value
                outbox.next_attempt_at = now
                outbox.last_error = "Practice source snapshot deletion lease expired"
                outbox.updated_at = now

        due = db.execute(
            select(PracticeSourceSnapshotDeleteOutbox.outbox_uuid)
            .where(
                PracticeSourceSnapshotDeleteOutbox.status.in_(
                    [
                        PracticeSourceSnapshotDeleteOutboxStatus.PENDING.value,
                        PracticeSourceSnapshotDeleteOutboxStatus.FAILED.value,
                    ]
                ),
                PracticeSourceSnapshotDeleteOutbox.next_attempt_at <= now,
                PracticeSourceSnapshotDeleteOutbox.attempt_count
                < settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
            )
            .order_by(PracticeSourceSnapshotDeleteOutbox.created_at)
            .limit(settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_BATCH_SIZE)
        )
        return list(due.scalars())

    @staticmethod
    def _build_payload(
        outbox: PracticeSourceSnapshotDeleteOutbox,
    ) -> PracticeSourceSnapshotDeletePayload:
        return PracticeSourceSnapshotDeletePayload(
            outbox_uuid=outbox.outbox_uuid,
            source_snapshot_id=outbox.source_snapshot_id,
            snapshot_uuid=outbox.snapshot_uuid,
            storage_backend=outbox.storage_backend,
            prepared_musicxml_object_key=outbox.prepared_musicxml_object_key,
            artifact_object_key=outbox.artifact_object_key,
            attempt=0,
            max_attempts=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
        )

    @staticmethod
    def _get(
        db: Session,
        outbox_uuid: str,
        *,
        lock: bool = False,
    ) -> PracticeSourceSnapshotDeleteOutbox | None:
        statement = select(PracticeSourceSnapshotDeleteOutbox).where(
            PracticeSourceSnapshotDeleteOutbox.outbox_uuid == outbox_uuid
        )
        if lock:
            statement = statement.with_for_update()
        return db.execute(statement).scalar_one_or_none()

    @staticmethod
    def _is_dispatchable(outbox: PracticeSourceSnapshotDeleteOutbox) -> bool:
        return (
            _status_value(outbox.status)
            in {
                PracticeSourceSnapshotDeleteOutboxStatus.PENDING.value,
                PracticeSourceSnapshotDeleteOutboxStatus.FAILED.value,
            }
            and outbox.attempt_count
            < settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS
            and outbox.next_attempt_at <= utc_now_naive()
        )


practice_source_snapshot_delete_service = PracticeSourceSnapshotDeleteService()
