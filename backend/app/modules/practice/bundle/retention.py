from __future__ import annotations


from dataclasses import dataclass, replace
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    PracticeBundleRecord,
    ScoreRevisionPracticeBinding,
    PracticeBundleStatus,
    PracticeBundleDeleteOutbox,
    PracticeBundleDeleteOutboxStatus,
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
class PracticeBundleDeletePayload:
    outbox_uuid: str
    practice_bundle_id: int | None
    bundle_id: str
    storage_backend: str
    prepared_musicxml_object_key: str
    artifact_object_key: str
    attempt: int
    max_attempts: int


class PracticeBundleDeleteService:
    def enqueue_if_unowned(
        self,
        db: Session,
        practice_bundle_id: int | None,
        *,
        storage_backend: str,
    ) -> PracticeBundleDeleteOutbox | None:
        if practice_bundle_id is None:
            return None
        bundle = db.execute(
            select(PracticeBundleRecord)
            .where(PracticeBundleRecord.id == practice_bundle_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if bundle is None:
            return None
        if self.has_owner(db, bundle):
            return None
        if bundle.status == PracticeBundleStatus.DELETING.value:
            return db.execute(
                select(PracticeBundleDeleteOutbox).where(
                    PracticeBundleDeleteOutbox.practice_bundle_id == practice_bundle_id,
                    PracticeBundleDeleteOutbox.status
                    != PracticeBundleDeleteOutboxStatus.COMPLETED.value,
                )
            ).scalar_one_or_none()
        if bundle.status != PracticeBundleStatus.READY.value:
            return None
        return self._enqueue(db, bundle, storage_backend=storage_backend)

    def discard_creation(
        self, db: Session, practice_bundle_id: int, *, storage_backend: str
    ) -> PracticeBundleDeleteOutbox | None:
        bundle = db.execute(
            select(PracticeBundleRecord)
            .where(
                PracticeBundleRecord.id == practice_bundle_id,
                PracticeBundleRecord.status == PracticeBundleStatus.CREATING.value,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if bundle is None:
            return None
        # Incomplete representations do not retain a usable live bundle.
        return self._enqueue(db, bundle, storage_backend=storage_backend)

    def _enqueue(
        self, db: Session, bundle: PracticeBundleRecord, *, storage_backend: str
    ) -> PracticeBundleDeleteOutbox:
        bundle.status = PracticeBundleStatus.DELETING.value
        bundle.creation_expires_at = None
        existing = db.execute(
            select(PracticeBundleDeleteOutbox).where(
                PracticeBundleDeleteOutbox.bundle_id == bundle.bundle_id,
                PracticeBundleDeleteOutbox.status
                != PracticeBundleDeleteOutboxStatus.COMPLETED.value,
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        outbox = PracticeBundleDeleteOutbox(
            practice_bundle_id=bundle.id,
            bundle_id=bundle.bundle_id,
            storage_backend=storage_backend,
            prepared_musicxml_object_key=bundle.prepared_musicxml_object_key,
            artifact_object_key=bundle.artifact_object_key,
            status=PracticeBundleDeleteOutboxStatus.PENDING.value,
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
        stale_bundles = list(
            db.execute(
                select(PracticeBundleRecord)
                .where(
                    PracticeBundleRecord.status == PracticeBundleStatus.CREATING.value,
                    PracticeBundleRecord.creation_expires_at.is_not(None),
                    PracticeBundleRecord.creation_expires_at <= now,
                )
                .limit(settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_BATCH_SIZE)
                .with_for_update(skip_locked=True)
                .execution_options(populate_existing=True)
            ).scalars()
        )
        outbox_ids: list[str] = []
        for bundle in stale_bundles:
            outbox = self.discard_creation(
                db,
                bundle.id,
                storage_backend=storage_backend,
            )
            if outbox is not None:
                outbox_ids.append(outbox.outbox_uuid)
        return outbox_ids

    def recover_unowned_ready(self, db: Session, *, storage_backend: str) -> list[str]:
        rows = (
            db.execute(
                select(PracticeBundleRecord)
                .where(
                    PracticeBundleRecord.status == PracticeBundleStatus.READY.value,
                    ~select(ScoreRevisionPracticeBinding.revision_id)
                    .where(ScoreRevisionPracticeBinding.bundle_id == PracticeBundleRecord.id)
                    .exists(),
                )
                .order_by(PracticeBundleRecord.id)
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

    @staticmethod
    def has_owner(db: Session, bundle: PracticeBundleRecord) -> bool:
        return (
            db.execute(
                select(ScoreRevisionPracticeBinding.revision_id)
                .where(ScoreRevisionPracticeBinding.bundle_id == bundle.id)
                .limit(1)
            ).scalar_one_or_none()
            is not None
        )

    def claim(
        self,
        db: Session,
        outbox_uuid: str,
    ) -> PracticeBundleDeletePayload | None:
        outbox = self._get(db, outbox_uuid, lock=True)
        if outbox is None or _status_value(outbox.status) in {
            PracticeBundleDeleteOutboxStatus.PROCESSING.value,
            PracticeBundleDeleteOutboxStatus.COMPLETED.value,
        }:
            return None
        if (
            _status_value(outbox.status) == PracticeBundleDeleteOutboxStatus.FAILED.value
            and outbox.next_attempt_at > utc_now_naive()
        ):
            return None
        if outbox.attempt_count >= settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS:
            return None

        if outbox.practice_bundle_id is not None:
            bundle = db.execute(
                select(PracticeBundleRecord)
                .where(PracticeBundleRecord.id == outbox.practice_bundle_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            ).scalar_one_or_none()
            if bundle is not None and (
                self.has_owner(db, bundle) or bundle.status != PracticeBundleStatus.DELETING.value
            ):
                outbox.status = PracticeBundleDeleteOutboxStatus.COMPLETED.value
                outbox.completed_at = utc_now_naive()
                outbox.last_error = (
                    "Bundle deletion cancelled: bundle has an owner or is not DELETING"
                )
                return None

        attempt = outbox.attempt_count + 1
        payload = replace(
            self._build_payload(outbox),
            attempt=attempt,
            max_attempts=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
        )
        now = utc_now_naive()
        outbox.status = PracticeBundleDeleteOutboxStatus.PROCESSING.value
        outbox.attempt_count += 1
        outbox.started_at = now
        outbox.updated_at = now
        return payload

    def complete(self, db: Session, outbox_uuid: str, *, attempt: int | None = None) -> bool:
        outbox = self._get(db, outbox_uuid, lock=True)
        if outbox is None:
            return False
        if _status_value(outbox.status) == PracticeBundleDeleteOutboxStatus.COMPLETED.value:
            if attempt is not None and outbox.attempt_count != attempt:
                return False
            return True
        if _status_value(outbox.status) != PracticeBundleDeleteOutboxStatus.PROCESSING.value:
            return False
        if attempt is not None and outbox.attempt_count != attempt:
            return False
        now = utc_now_naive()
        outbox.status = PracticeBundleDeleteOutboxStatus.COMPLETED.value
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
        if _status_value(outbox.status) != PracticeBundleDeleteOutboxStatus.PROCESSING.value:
            return False
        if attempt is not None and outbox.attempt_count != attempt:
            return False
        delay = exponential_retry_delay_seconds(
            base_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_RETRY_BASE_SECONDS,
            attempt_count=outbox.attempt_count,
        )
        now = utc_now_naive()
        outbox.status = PracticeBundleDeleteOutboxStatus.FAILED.value
        outbox.next_attempt_at = now + timedelta(seconds=delay)
        outbox.last_error = error[:4000]
        outbox.updated_at = now
        return True

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not self._is_dispatchable(outbox):
            return False
        now = utc_now_naive()
        outbox.status = PracticeBundleDeleteOutboxStatus.DISPATCHED.value
        outbox.dispatched_at = now
        outbox.updated_at = now
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if (
            outbox is None
            or _status_value(outbox.status) != PracticeBundleDeleteOutboxStatus.DISPATCHED.value
        ):
            return
        outbox.status = PracticeBundleDeleteOutboxStatus.PENDING.value
        outbox.dispatched_at = None
        outbox.last_error = error[:4000]
        outbox.updated_at = utc_now_naive()

    def recover_and_list_due(self, db: Session) -> list[str]:
        self.recover_stale_creating(db, storage_backend=settings.FILE_STORAGE_BACKEND)
        self.recover_unowned_ready(db, storage_backend=settings.FILE_STORAGE_BACKEND)
        now = utc_now_naive()
        stale = db.execute(
            select(PracticeBundleDeleteOutbox).where(
                or_(
                    PracticeBundleDeleteOutbox.status
                    == PracticeBundleDeleteOutboxStatus.DISPATCHED.value,
                    PracticeBundleDeleteOutbox.status
                    == PracticeBundleDeleteOutboxStatus.PROCESSING.value,
                )
            )
        ).scalars()
        for outbox in stale:
            if delivery_lease_expired(
                status=outbox.status,
                dispatched_status=PracticeBundleDeleteOutboxStatus.DISPATCHED.value,
                processing_status=PracticeBundleDeleteOutboxStatus.PROCESSING.value,
                dispatched_at=outbox.dispatched_at,
                started_at=outbox.started_at,
                now=now,
                dispatch_timeout_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_TIMEOUT_SECONDS,
                processing_timeout_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_PROCESSING_TIMEOUT_SECONDS,
            ):
                outbox.status = PracticeBundleDeleteOutboxStatus.FAILED.value
                outbox.next_attempt_at = now
                outbox.last_error = "Practice bundle deletion lease expired"
                outbox.updated_at = now

        due = db.execute(
            select(PracticeBundleDeleteOutbox.outbox_uuid)
            .where(
                PracticeBundleDeleteOutbox.status.in_(
                    [
                        PracticeBundleDeleteOutboxStatus.PENDING.value,
                        PracticeBundleDeleteOutboxStatus.FAILED.value,
                    ]
                ),
                PracticeBundleDeleteOutbox.next_attempt_at <= now,
                PracticeBundleDeleteOutbox.attempt_count
                < settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
            )
            .order_by(PracticeBundleDeleteOutbox.created_at)
            .limit(settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_BATCH_SIZE)
        )
        return list(due.scalars())

    @staticmethod
    def _build_payload(
        outbox: PracticeBundleDeleteOutbox,
    ) -> PracticeBundleDeletePayload:
        return PracticeBundleDeletePayload(
            outbox_uuid=outbox.outbox_uuid,
            practice_bundle_id=outbox.practice_bundle_id,
            bundle_id=outbox.bundle_id,
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
    ) -> PracticeBundleDeleteOutbox | None:
        statement = select(PracticeBundleDeleteOutbox).where(
            PracticeBundleDeleteOutbox.outbox_uuid == outbox_uuid
        )
        if lock:
            statement = statement.with_for_update()
        return db.execute(statement.execution_options(populate_existing=True)).scalar_one_or_none()

    @staticmethod
    def _is_dispatchable(outbox: PracticeBundleDeleteOutbox) -> bool:
        return (
            _status_value(outbox.status)
            in {
                PracticeBundleDeleteOutboxStatus.PENDING.value,
                PracticeBundleDeleteOutboxStatus.FAILED.value,
            }
            and outbox.attempt_count < settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS
            and outbox.next_attempt_at <= utc_now_naive()
        )


practice_bundle_delete_service = PracticeBundleDeleteService()
