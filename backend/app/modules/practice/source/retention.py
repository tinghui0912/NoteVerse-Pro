from __future__ import annotations

from app.modules.performance_takes.upload_reservation.domain import SOURCE_OWNING_STATUSES

from dataclasses import dataclass, replace
from datetime import timedelta

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.db.model_utils import require_persisted_id
from app.db.models import (
    PerformanceTake,
    PerformanceTakeUploadReservation,
    PracticeSourceRecord,
    PracticeSourceStatus,
    PracticeSourceDeleteOutbox,
    PracticeSourceDeleteOutboxStatus,
)
from app.modules.async_operations.delivery_policy import (
    delivery_lease_expired,
    exponential_retry_delay_seconds,
)
from app.utils.timezone import utc_now_naive


def _status_value(status: object) -> str:
    value = getattr(status, "value", status)
    return str(value)


@dataclass(frozen=True)
class PracticeSourceDeletePayload:
    outbox_uuid: str
    practice_source_id: int | None
    source_id: str
    storage_backend: str
    prepared_musicxml_object_key: str
    artifact_object_key: str
    attempt: int
    max_attempts: int


class PracticeSourceDeleteService:
    async def enqueue_if_unowned_async(
        self, db: AsyncSession, practice_source_id: int | None, *, storage_backend: str
    ) -> None:
        await db.run_sync(
            lambda sync_db: self.enqueue_if_unowned(
                sync_db, practice_source_id, storage_backend=storage_backend
            )
        )

    def active_reference_count(self, db: Session, practice_source_id: int) -> int:
        take_refs = db.execute(
            select(func.count(PerformanceTake.id)).where(
                PerformanceTake.practice_source_id == practice_source_id
            )
        ).scalar_one()
        reservation_refs = db.execute(
            select(func.count(PerformanceTakeUploadReservation.id)).where(
                PerformanceTakeUploadReservation.practice_source_id == practice_source_id,
                PerformanceTakeUploadReservation.status.in_([status.value for status in SOURCE_OWNING_STATUSES]),
            )
        ).scalar_one()
        return int(take_refs) + int(reservation_refs)

    def enqueue_if_unowned(
        self,
        db: Session,
        practice_source_id: int | None,
        *,
        storage_backend: str,
    ) -> PracticeSourceDeleteOutbox | None:
        if practice_source_id is None:
            return None
        source = db.execute(
            select(PracticeSourceRecord)
            .where(PracticeSourceRecord.id == practice_source_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if source is None:
            return None
        if self.has_owner(db, source):
            return None
        if source.status == PracticeSourceStatus.DELETING.value:
            return db.execute(
                select(PracticeSourceDeleteOutbox).where(
                    PracticeSourceDeleteOutbox.practice_source_id == practice_source_id,
                    PracticeSourceDeleteOutbox.status
                    != PracticeSourceDeleteOutboxStatus.COMPLETED.value,
                )
            ).scalar_one_or_none()
        if source.status != PracticeSourceStatus.READY.value:
            return None
        return self._enqueue(db, source, storage_backend=storage_backend)

    def discard_creation(
        self, db: Session, practice_source_id: int, *, storage_backend: str
    ) -> PracticeSourceDeleteOutbox | None:
        source = db.execute(
            select(PracticeSourceRecord)
            .where(
                PracticeSourceRecord.id == practice_source_id,
                PracticeSourceRecord.status == PracticeSourceStatus.CREATING.value,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if source is None or self.active_reference_count(db, practice_source_id) > 0:
            return None
        # Incomplete representations do not retain a usable live source.
        source.live_revision_id = None
        return self._enqueue(db, source, storage_backend=storage_backend)

    def _enqueue(
        self, db: Session, source: PracticeSourceRecord, *, storage_backend: str
    ) -> PracticeSourceDeleteOutbox:
        source.status = PracticeSourceStatus.DELETING.value
        source.creation_expires_at = None
        existing = db.execute(
            select(PracticeSourceDeleteOutbox).where(
                PracticeSourceDeleteOutbox.source_id == source.source_id,
                PracticeSourceDeleteOutbox.status
                != PracticeSourceDeleteOutboxStatus.COMPLETED.value,
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        outbox = PracticeSourceDeleteOutbox(
            practice_source_id=source.id,
            source_id=source.source_id,
            storage_backend=storage_backend,
            prepared_musicxml_object_key=source.prepared_musicxml_object_key,
            artifact_object_key=source.artifact_object_key,
            status=PracticeSourceDeleteOutboxStatus.PENDING.value,
            max_attempts=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
        )
        db.add(outbox)
        db.flush()
        return outbox

    def recover_stale_creating(
        self,
        db: Session,
        *,
        storage_backend: str,
    ) -> list[str]:
        now = utc_now_naive()
        stale_sources = list(
            db.execute(
                select(PracticeSourceRecord)
                .where(
                    PracticeSourceRecord.status == PracticeSourceStatus.CREATING.value,
                    PracticeSourceRecord.creation_expires_at.is_not(None),
                    PracticeSourceRecord.creation_expires_at <= now,
                )
                .limit(settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_BATCH_SIZE)
                .with_for_update(skip_locked=True)
                .execution_options(populate_existing=True)
            ).scalars()
        )
        outbox_ids: list[str] = []
        for source in stale_sources:
            outbox = self.discard_creation(
                db,
                source.id,
                storage_backend=storage_backend,
            )
            if outbox is not None:
                outbox_ids.append(outbox.outbox_uuid)
        return outbox_ids

    def recover_unowned_ready(self, db: Session, *, storage_backend: str) -> list[str]:
        refs = (
            select(PerformanceTake.id)
            .where(PerformanceTake.practice_source_id == PracticeSourceRecord.id)
            .exists()
        )
        reservations = (
            select(PerformanceTakeUploadReservation.id)
            .where(
                PerformanceTakeUploadReservation.practice_source_id == PracticeSourceRecord.id,
                PerformanceTakeUploadReservation.status.in_([status.value for status in SOURCE_OWNING_STATUSES]),
            )
            .exists()
        )
        rows = (
            db.execute(
                select(PracticeSourceRecord)
                .where(
                    PracticeSourceRecord.status == PracticeSourceStatus.READY.value,
                    PracticeSourceRecord.live_revision_id.is_(None),
                    ~refs,
                    ~reservations,
                )
                .order_by(PracticeSourceRecord.id)
                .limit(settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_BATCH_SIZE)
                .with_for_update(skip_locked=True)
                .execution_options(populate_existing=True)
            )
            .scalars()
            .all()
        )
        return [
            outbox.outbox_uuid
            for row in rows
            if (outbox := self.enqueue_if_unowned(db, row.id, storage_backend=storage_backend))
            is not None
        ]

    def has_owner(self, db: Session, source: PracticeSourceRecord) -> bool:
        return (
            source.live_revision_id is not None
            or self.active_reference_count(
                db, require_persisted_id(source.id, entity="practice source")
            )
            > 0
        )

    def claim(
        self,
        db: Session,
        outbox_uuid: str,
    ) -> PracticeSourceDeletePayload | None:
        outbox = self._get(db, outbox_uuid, lock=True)
        if outbox is None or _status_value(outbox.status) in {
            PracticeSourceDeleteOutboxStatus.PROCESSING.value,
            PracticeSourceDeleteOutboxStatus.COMPLETED.value,
        }:
            return None
        if (
            _status_value(outbox.status) == PracticeSourceDeleteOutboxStatus.FAILED.value
            and outbox.next_attempt_at > utc_now_naive()
        ):
            return None
        if outbox.attempt_count >= settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS:
            return None

        if outbox.practice_source_id is not None:
            source = db.execute(
                select(PracticeSourceRecord)
                .where(PracticeSourceRecord.id == outbox.practice_source_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).scalar_one_or_none()
            if source is not None and (
                self.has_owner(db, source) or source.status != PracticeSourceStatus.DELETING.value
            ):
                outbox.status = PracticeSourceDeleteOutboxStatus.COMPLETED.value
                outbox.completed_at = utc_now_naive()
                outbox.last_error = (
                    "Source deletion cancelled: source has an owner or is not DELETING"
                )
                return None

        attempt = outbox.attempt_count + 1
        payload = replace(
            self._build_payload(outbox),
            attempt=attempt,
            max_attempts=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
        )
        now = utc_now_naive()
        outbox.status = PracticeSourceDeleteOutboxStatus.PROCESSING.value
        outbox.attempt_count += 1
        outbox.started_at = now
        outbox.updated_at = now
        return payload

    def complete(self, db: Session, outbox_uuid: str, *, attempt: int | None = None) -> bool:
        outbox = self._get(db, outbox_uuid, lock=True)
        if outbox is None:
            return False
        if _status_value(outbox.status) == PracticeSourceDeleteOutboxStatus.COMPLETED.value:
            if attempt is not None and outbox.attempt_count != attempt:
                return False
            return True
        if _status_value(outbox.status) != PracticeSourceDeleteOutboxStatus.PROCESSING.value:
            return False
        if attempt is not None and outbox.attempt_count != attempt:
            return False
        now = utc_now_naive()
        outbox.status = PracticeSourceDeleteOutboxStatus.COMPLETED.value
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
        if _status_value(outbox.status) != PracticeSourceDeleteOutboxStatus.PROCESSING.value:
            return False
        if attempt is not None and outbox.attempt_count != attempt:
            return False
        delay = exponential_retry_delay_seconds(
            base_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_RETRY_BASE_SECONDS,
            attempt_count=outbox.attempt_count,
        )
        now = utc_now_naive()
        outbox.status = PracticeSourceDeleteOutboxStatus.FAILED.value
        outbox.next_attempt_at = now + timedelta(seconds=delay)
        outbox.last_error = error[:4000]
        outbox.updated_at = now
        return True

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not self._is_dispatchable(outbox):
            return False
        now = utc_now_naive()
        outbox.status = PracticeSourceDeleteOutboxStatus.DISPATCHED.value
        outbox.dispatched_at = now
        outbox.updated_at = now
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if (
            outbox is None
            or _status_value(outbox.status) != PracticeSourceDeleteOutboxStatus.DISPATCHED.value
        ):
            return
        outbox.status = PracticeSourceDeleteOutboxStatus.PENDING.value
        outbox.dispatched_at = None
        outbox.last_error = error[:4000]
        outbox.updated_at = utc_now_naive()

    def recover_and_list_due(self, db: Session) -> list[str]:
        self.recover_stale_creating(db, storage_backend=settings.FILE_STORAGE_BACKEND)
        self.recover_unowned_ready(db, storage_backend=settings.FILE_STORAGE_BACKEND)
        now = utc_now_naive()
        stale = db.execute(
            select(PracticeSourceDeleteOutbox).where(
                or_(
                    PracticeSourceDeleteOutbox.status
                    == PracticeSourceDeleteOutboxStatus.DISPATCHED.value,
                    PracticeSourceDeleteOutbox.status
                    == PracticeSourceDeleteOutboxStatus.PROCESSING.value,
                )
            )
        ).scalars()
        for outbox in stale:
            if delivery_lease_expired(
                status=outbox.status,
                dispatched_status=PracticeSourceDeleteOutboxStatus.DISPATCHED.value,
                processing_status=PracticeSourceDeleteOutboxStatus.PROCESSING.value,
                dispatched_at=outbox.dispatched_at,
                started_at=outbox.started_at,
                now=now,
                dispatch_timeout_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_TIMEOUT_SECONDS,
                processing_timeout_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_PROCESSING_TIMEOUT_SECONDS,
            ):
                outbox.status = PracticeSourceDeleteOutboxStatus.FAILED.value
                outbox.next_attempt_at = now
                outbox.last_error = "Practice source deletion lease expired"
                outbox.updated_at = now

        due = db.execute(
            select(PracticeSourceDeleteOutbox.outbox_uuid)
            .where(
                PracticeSourceDeleteOutbox.status.in_(
                    [
                        PracticeSourceDeleteOutboxStatus.PENDING.value,
                        PracticeSourceDeleteOutboxStatus.FAILED.value,
                    ]
                ),
                PracticeSourceDeleteOutbox.next_attempt_at <= now,
                PracticeSourceDeleteOutbox.attempt_count
                < settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
            )
            .order_by(PracticeSourceDeleteOutbox.created_at)
            .limit(settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_BATCH_SIZE)
        )
        return list(due.scalars())

    @staticmethod
    def _build_payload(
        outbox: PracticeSourceDeleteOutbox,
    ) -> PracticeSourceDeletePayload:
        return PracticeSourceDeletePayload(
            outbox_uuid=outbox.outbox_uuid,
            practice_source_id=outbox.practice_source_id,
            source_id=outbox.source_id,
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
    ) -> PracticeSourceDeleteOutbox | None:
        statement = select(PracticeSourceDeleteOutbox).where(
            PracticeSourceDeleteOutbox.outbox_uuid == outbox_uuid
        )
        if lock:
            statement = statement.with_for_update()
        return db.execute(statement.execution_options(populate_existing=True)).scalar_one_or_none()

    @staticmethod
    def _is_dispatchable(outbox: PracticeSourceDeleteOutbox) -> bool:
        return (
            _status_value(outbox.status)
            in {
                PracticeSourceDeleteOutboxStatus.PENDING.value,
                PracticeSourceDeleteOutboxStatus.FAILED.value,
            }
            and outbox.attempt_count < settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS
            and outbox.next_attempt_at <= utc_now_naive()
        )


practice_source_delete_service = PracticeSourceDeleteService()
