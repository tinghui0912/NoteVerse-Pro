"""Durable Take verification separates uploaded bytes from media readiness."""

from uuid import uuid4
from datetime import timedelta
from sqlalchemy import select, and_, or_
from sqlalchemy.orm import Session
from app.db.models import PerformanceTake, TakeProcessingOutbox
from app.modules.media_storage.verification import ObjectIntegrityVerifier
from app.modules.media_storage.persistence import object_from_row
from app.modules.media_storage.write_coordinator import SessionFactory
from app.modules.durable_work.delivery import (
    DurableDeliveryLifecycle,
    DeliveryStatuses,
    DeliveryLifecyclePolicy,
)
from app.modules.durable_work.failure import DurableFailure, set_failure_facts, clear_failure_facts
from app.shared.durable_failure import DurableFailureClass
from app.storage.base import ObjectStorageUnavailableError
from app.shared.time import utc_now
from .processing_states import TakeProcessingStatus as Status, TakeMediaStatus as Media
from .recording_media_admission import verify_recording_container_signature
from .manifest_persistence import manifest_from_row


class TakeMediaProcessing:
    def __init__(
        self,
        sessions: SessionFactory,
        verifier: ObjectIntegrityVerifier,
        policy: DeliveryLifecyclePolicy,
    ) -> None:
        self.sessions, self.verifier = sessions, verifier
        self.lifecycle = DurableDeliveryLifecycle(
            DeliveryStatuses(
                Status.PENDING,
                Status.DISPATCHED,
                Status.PROCESSING,
                Status.FAILED,
                Status.COMPLETED,
            ),
            policy,
        )

    @staticmethod
    def _row(db: Session, uuid: str) -> TakeProcessingOutbox | None:
        return db.scalar(
            select(TakeProcessingOutbox)
            .where(TakeProcessingOutbox.operation_uuid == uuid)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def execute(self, uuid: str) -> str:
        with self.sessions() as db:
            identity = db.scalar(
                select(TakeProcessingOutbox.take_id).where(
                    TakeProcessingOutbox.operation_uuid == uuid
                )
            )
            take = (
                db.scalar(
                    select(PerformanceTake).where(PerformanceTake.id == identity).with_for_update()
                )
                if identity is not None
                else None
            )
            row = self._row(db, uuid)
            if (
                row is None
                or take is None
                or (row.status == Status.FAILED and row.failure_retryable is False)
            ):
                return "ignored"
            lease = self.lifecycle.claim(row, token=str(uuid4()), now=utc_now())
            if lease is None:
                return "ignored"
            clear_failure_facts(row)
            take.media_status = Media.PROCESSING
            identity, object_id = take.id, take.recording_object_id
            facts = object_from_row(take.recording_object)
            capture = manifest_from_row(take.manifest).snapshot.capture
            db.commit()
        try:
            result = self.verifier.verify(facts)
            if not verify_recording_container_signature(
                capture.kind, capture.mime_type, result.prefix
            ):
                raise ValueError("Recording container is invalid")
            with self.sessions() as db:
                take = db.scalar(
                    select(PerformanceTake).where(PerformanceTake.id == identity).with_for_update()
                )
                row = self._row(db, uuid)
                if take is None or row is None or not self.lifecycle.attempt_matches(row, lease):
                    return "stale"
                self.verifier.enrich(db, object_id, result)
                take.media_status = Media.READY
                self.lifecycle.complete_attempt(row, lease=lease, now=utc_now())
                clear_failure_facts(row)
                db.commit()
            return "completed"
        except Exception as error:
            with self.sessions() as db:
                take = db.scalar(
                    select(PerformanceTake).where(PerformanceTake.id == identity).with_for_update()
                )
                row = self._row(db, uuid)
                if (
                    take is None
                    or row is None
                    or not self.lifecycle.fail_attempt(
                        row, lease=lease, error="Take media verification failed", now=utc_now()
                    )
                ):
                    return "stale"
                transient = isinstance(error, (ObjectStorageUnavailableError, OSError))
                exhausted = row.attempt_count >= self.lifecycle.policy.max_attempts
                set_failure_facts(
                    row,
                    DurableFailure(
                        "take_media_unavailable" if transient else "take_media_invalid",
                        "verification",
                        DurableFailureClass.TRANSIENT
                        if transient
                        else DurableFailureClass.PERMANENT,
                        transient and not exhausted,
                    ),
                    detail="Take media verification failed",
                )
                take.media_status = Media.FAILED
                db.commit()
            return "failed"

    def due(self) -> list[str]:
        now, policy = utc_now(), self.lifecycle.policy
        with self.sessions() as db:
            candidates = db.execute(
                select(TakeProcessingOutbox.operation_uuid, TakeProcessingOutbox.take_id)
                .where(
                    or_(
                        and_(
                            TakeProcessingOutbox.status.in_((Status.PENDING, Status.FAILED)),
                            TakeProcessingOutbox.next_attempt_at <= now,
                            TakeProcessingOutbox.attempt_count < policy.max_attempts,
                            TakeProcessingOutbox.failure_retryable.is_not(False),
                        ),
                        and_(
                            TakeProcessingOutbox.status == Status.DISPATCHED,
                            TakeProcessingOutbox.dispatched_at
                            <= now - timedelta(seconds=policy.dispatch_timeout_seconds),
                        ),
                        and_(
                            TakeProcessingOutbox.status == Status.PROCESSING,
                            TakeProcessingOutbox.started_at
                            <= now - timedelta(seconds=policy.processing_timeout_seconds),
                        ),
                    )
                )
                .order_by(TakeProcessingOutbox.created_at)
                .limit(100)
            ).all()
        result = []
        for uuid, take_id in candidates:
            with self.sessions() as db:
                take = db.scalar(
                    select(PerformanceTake)
                    .where(PerformanceTake.id == take_id)
                    .with_for_update(skip_locked=True)
                )
                if take is None:
                    continue
                row = self._row(db, uuid)
                if row is None:
                    continue
                recovered = self.lifecycle.recover_lease(
                    row, error="Take processing lease expired", now=now
                )
                if recovered:
                    exhausted = row.attempt_count >= policy.max_attempts
                    set_failure_facts(
                        row,
                        DurableFailure(
                            "take_media_attempts_exhausted"
                            if exhausted
                            else "take_media_lease_expired",
                            "lease",
                            DurableFailureClass.SYSTEM_ERROR,
                            not exhausted,
                        ),
                        detail="Take processing lease expired",
                    )
                    take.media_status = Media.FAILED
                if row.failure_retryable is not False and self.lifecycle.is_dispatchable(
                    row, now=now
                ):
                    self.lifecycle.dispatch(row, now=now)
                    result.append(row.operation_uuid)
                db.commit()
        return result

    def release_dispatch(self, uuid: str) -> None:
        with self.sessions() as db:
            row = self._row(db, uuid)
            if row is not None:
                self.lifecycle.release_dispatch(
                    row, error="Take processing dispatch unavailable", now=utc_now()
                )
                db.commit()
