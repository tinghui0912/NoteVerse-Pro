from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import timedelta

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    PerformanceTakeDeleteOutbox,
    PerformanceTakeDeleteOutboxStatus,
    PerformanceTakeUploadAuthorization,
    PerformanceTakeUploadAuthorizationStatus,
)
from app.modules.async_operations.delivery_policy import (
    delivery_lease_expired,
    exponential_retry_delay_seconds,
)
from app.modules.storage_usage.service import StorageUsageService
from app.storage.base import FileStorage
from app.utils.timezone import utc_now_naive


@dataclass(frozen=True)
class PerformanceTakeDeletePayload:
    outbox_uuid: str
    take_id: int
    take_uuid: str
    user_id: int
    storage_backend: str
    object_key: str
    media_byte_size: int
    attempt: int
    max_attempts: int


class PerformanceTakeDeleteOutboxService:
    def claim(
        self,
        db: Session,
        outbox_uuid: str,
    ) -> PerformanceTakeDeletePayload | None:
        outbox = db.execute(
            select(PerformanceTakeDeleteOutbox)
            .where(PerformanceTakeDeleteOutbox.outbox_uuid == outbox_uuid)
            .with_for_update()
        ).scalar_one_or_none()
        if outbox is None or outbox.status in {
            PerformanceTakeDeleteOutboxStatus.PROCESSING,
            PerformanceTakeDeleteOutboxStatus.COMPLETED,
        }:
            return None
        if (
            outbox.status == PerformanceTakeDeleteOutboxStatus.FAILED
            and outbox.next_attempt_at > utc_now_naive()
        ):
            return None
        if outbox.attempt_count >= settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS:
            return None

        attempt = outbox.attempt_count + 1
        payload = replace(
            self._build_payload(outbox),
            attempt=attempt,
            max_attempts=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
        )
        now = utc_now_naive()
        outbox.status = PerformanceTakeDeleteOutboxStatus.PROCESSING
        outbox.attempt_count += 1
        outbox.started_at = now
        outbox.updated_at = now
        return payload

    def _build_payload(
        self,
        outbox: PerformanceTakeDeleteOutbox,
    ) -> PerformanceTakeDeletePayload:
        return PerformanceTakeDeletePayload(
            outbox_uuid=outbox.outbox_uuid,
            take_id=outbox.take_id,
            take_uuid=outbox.take_uuid,
            user_id=outbox.user_id,
            storage_backend=outbox.storage_backend,
            object_key=outbox.object_key,
            media_byte_size=outbox.media_byte_size,
            attempt=0,
            max_attempts=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
        )

    def complete(self, db: Session, outbox_uuid: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None:
            return
        now = utc_now_naive()
        outbox.status = PerformanceTakeDeleteOutboxStatus.COMPLETED
        outbox.completed_at = now
        outbox.last_error = None
        outbox.updated_at = now

    def fail(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None:
            return
        now = utc_now_naive()
        delay = exponential_retry_delay_seconds(
            base_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_RETRY_BASE_SECONDS,
            attempt_count=outbox.attempt_count,
        )
        outbox.status = PerformanceTakeDeleteOutboxStatus.FAILED
        outbox.next_attempt_at = now + timedelta(seconds=delay)
        outbox.last_error = error[:4000]
        outbox.updated_at = now

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not self._is_dispatchable(outbox):
            return False
        now = utc_now_naive()
        outbox.status = PerformanceTakeDeleteOutboxStatus.DISPATCHED
        outbox.dispatched_at = now
        outbox.updated_at = now
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or outbox.status != PerformanceTakeDeleteOutboxStatus.DISPATCHED:
            return
        outbox.status = PerformanceTakeDeleteOutboxStatus.PENDING
        outbox.dispatched_at = None
        outbox.last_error = error[:4000]
        outbox.updated_at = utc_now_naive()

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        stale = db.execute(
            select(PerformanceTakeDeleteOutbox).where(
                or_(
                    PerformanceTakeDeleteOutbox.status
                    == PerformanceTakeDeleteOutboxStatus.DISPATCHED,
                    PerformanceTakeDeleteOutbox.status
                    == PerformanceTakeDeleteOutboxStatus.PROCESSING,
                )
            )
        ).scalars()
        for outbox in stale:
            if delivery_lease_expired(
                status=outbox.status,
                dispatched_status=PerformanceTakeDeleteOutboxStatus.DISPATCHED,
                processing_status=PerformanceTakeDeleteOutboxStatus.PROCESSING,
                dispatched_at=outbox.dispatched_at,
                started_at=outbox.started_at,
                now=now,
                dispatch_timeout_seconds=(
                    settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_TIMEOUT_SECONDS
                ),
                processing_timeout_seconds=(
                    settings.PERFORMANCE_TAKE_DELETE_OUTBOX_PROCESSING_TIMEOUT_SECONDS
                ),
            ):
                outbox.status = PerformanceTakeDeleteOutboxStatus.FAILED
                outbox.next_attempt_at = now
                outbox.last_error = "Performance take deletion lease expired"
                outbox.updated_at = now

        due = db.execute(
            select(PerformanceTakeDeleteOutbox.outbox_uuid)
            .where(
                PerformanceTakeDeleteOutbox.status.in_(
                    [
                        PerformanceTakeDeleteOutboxStatus.PENDING,
                        PerformanceTakeDeleteOutboxStatus.FAILED,
                    ]
                ),
                PerformanceTakeDeleteOutbox.next_attempt_at <= now,
                PerformanceTakeDeleteOutbox.attempt_count
                < settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
            )
            .order_by(PerformanceTakeDeleteOutbox.created_at)
            .limit(settings.PERFORMANCE_TAKE_DELETE_OUTBOX_DISPATCH_BATCH_SIZE)
        )
        return list(due.scalars())

    def cleanup_expired_authorizations(
        self,
        db: Session,
        storage: FileStorage,
        storage_usage_service: StorageUsageService,
    ) -> int:
        now = utc_now_naive()
        expired_auths = db.execute(
            select(PerformanceTakeUploadAuthorization).where(
                PerformanceTakeUploadAuthorization.status
                == PerformanceTakeUploadAuthorizationStatus.AUTHORIZED,
                PerformanceTakeUploadAuthorization.expires_at <= now,
            )
        ).scalars().all()

        cleaned_count = 0
        for auth in expired_auths:
            auth.status = PerformanceTakeUploadAuthorizationStatus.EXPIRED
            auth.updated_at = now
            if storage is not None and storage.exists(auth.staging_object_key):
                storage.delete(auth.staging_object_key)
            storage_usage_service.release_reservation_sync(
                db, auth.reservation_id, auto_commit=False
            )
            cleaned_count += 1

        return cleaned_count

    @staticmethod
    def _get(
        db: Session,
        outbox_uuid: str,
    ) -> PerformanceTakeDeleteOutbox | None:
        return db.execute(
            select(PerformanceTakeDeleteOutbox).where(
                PerformanceTakeDeleteOutbox.outbox_uuid == outbox_uuid
            )
        ).scalar_one_or_none()

    @staticmethod
    def _is_dispatchable(outbox: PerformanceTakeDeleteOutbox) -> bool:
        return (
            outbox.status
            in {
                PerformanceTakeDeleteOutboxStatus.PENDING,
                PerformanceTakeDeleteOutboxStatus.FAILED,
            }
            and outbox.attempt_count
            < settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS
            and outbox.next_attempt_at <= utc_now_naive()
        )


performance_take_delete_outbox_service = PerformanceTakeDeleteOutboxService()
