from __future__ import annotations


from dataclasses import dataclass, replace

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
from app.modules.async_operations.durable_delivery import (
    ClaimAdmission,
    DeliveryLifecyclePolicy,
    DeliveryStatuses,
    DurableDeliveryLifecycle,
)
from app.utils.timezone import utc_now_naive


def _delivery_lifecycle() -> DurableDeliveryLifecycle[str]:
    return DurableDeliveryLifecycle(
        statuses=DeliveryStatuses(
            pending=PracticeBundleDeleteOutboxStatus.PENDING.value,
            dispatched=PracticeBundleDeleteOutboxStatus.DISPATCHED.value,
            processing=PracticeBundleDeleteOutboxStatus.PROCESSING.value,
            failed=PracticeBundleDeleteOutboxStatus.FAILED.value,
            succeeded=PracticeBundleDeleteOutboxStatus.COMPLETED.value,
        ),
        policy=DeliveryLifecyclePolicy(
            max_attempts=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
            retry_base_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_RETRY_BASE_SECONDS,
            dispatch_timeout_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_TIMEOUT_SECONDS,
            processing_timeout_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_PROCESSING_TIMEOUT_SECONDS,
        ),
    )


@dataclass(frozen=True)
class PracticeBundleDeletePayload:
    outbox_uuid: str
    practice_bundle_id: int | None
    bundle_id: str

    prepared_musicxml_object_key: str
    artifact_object_key: str
    attempt: int
    max_attempts: int


class PracticeBundleDeleteService:
    def enqueue_if_unowned(
        self,
        db: Session,
        practice_bundle_id: int | None,
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
        return self._enqueue(db, bundle)

    def discard_creation(
        self, db: Session, practice_bundle_id: int
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
        return self._enqueue(db, bundle)

    def _enqueue(self, db: Session, bundle: PracticeBundleRecord) -> PracticeBundleDeleteOutbox:
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
            )
            if outbox is not None:
                outbox_ids.append(outbox.outbox_uuid)
        return outbox_ids

    def recover_unowned_ready(self, db: Session) -> list[str]:
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
            if (outbox := self.enqueue_if_unowned(db, row.id)) is not None
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
        if outbox is None:
            return None
        lifecycle = _delivery_lifecycle()
        if lifecycle.claim_admission(outbox, now=utc_now_naive()) is not ClaimAdmission.READY:
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
                lifecycle.finish(
                    outbox,
                    status=PracticeBundleDeleteOutboxStatus.COMPLETED.value,
                    error="Bundle deletion cancelled: bundle has an owner or is not DELETING",
                    now=utc_now_naive(),
                )
                return None

        payload = self._build_payload(outbox)
        if not lifecycle.claim(outbox, now=utc_now_naive()):
            return None
        return replace(
            payload, attempt=outbox.attempt_count, max_attempts=lifecycle.policy.max_attempts
        )

    def complete(self, db: Session, outbox_uuid: str, *, attempt: int | None = None) -> bool:
        outbox = self._get(db, outbox_uuid, lock=True)
        if outbox is None:
            return False
        return _delivery_lifecycle().complete_attempt(
            outbox, expected_attempt=attempt, now=utc_now_naive()
        )

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
        return _delivery_lifecycle().fail_attempt(
            outbox, expected_attempt=attempt, error=error, now=utc_now_naive()
        )

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not _delivery_lifecycle().dispatch(outbox, now=utc_now_naive()):
            return False
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is not None:
            _delivery_lifecycle().release_dispatch(outbox, error=error, now=utc_now_naive())

    def recover_and_list_due(self, db: Session) -> list[str]:
        self.recover_stale_creating(db)
        self.recover_unowned_ready(db)
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
            _delivery_lifecycle().recover_lease(
                outbox, error="Practice bundle deletion lease expired", now=now
            )

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


practice_bundle_delete_service = PracticeBundleDeleteService()
