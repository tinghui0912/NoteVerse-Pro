from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import timedelta
import json
import logging

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.models import (
    PerformanceTake,
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

logger = logging.getLogger(__name__)


def _load_orphan_final_keys(value: str | None) -> list[str]:
    if not value:
        return []
    try:
        decoded = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(decoded, list):
        return []
    return [item for item in decoded if isinstance(item, str) and item]


def _dump_orphan_final_keys(keys: list[str]) -> str | None:
    unique: list[str] = []
    for key in keys:
        if key and key not in unique:
            unique.append(key)
    if not unique:
        return None
    return json.dumps(unique, sort_keys=True, separators=(",", ":"))


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


@dataclass(frozen=True)
class AuthorizationCleanupTarget:
    authorization_id: int
    status: PerformanceTakeUploadAuthorizationStatus
    staging_object_key: str
    final_object_key: str
    orphan_final_object_keys: tuple[str, ...]
    delete_final_without_take: bool
    can_finalize_staging_cleanup: bool
    can_finalize_final_cleanup: bool


@dataclass(frozen=True)
class AuthorizationCleanupResult:
    staging_absent_confirmed: bool = False
    staging_deleted: bool = False
    final_absent_confirmed: bool = False
    final_deleted: bool = False
    absent_orphan_final_object_keys: tuple[str, ...] = ()

    @property
    def touched_storage(self) -> bool:
        return (
            self.staging_absent_confirmed
            or self.staging_deleted
            or self.final_absent_confirmed
            or self.final_deleted
            or bool(self.absent_orphan_final_object_keys)
        )


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

    def complete(self, db: Session, outbox_uuid: str, *, attempt: int | None = None) -> bool:
        outbox = self._get(db, outbox_uuid, lock=True)
        if outbox is None:
            return False
        if outbox.status == PerformanceTakeDeleteOutboxStatus.COMPLETED:
            if attempt is not None and outbox.attempt_count != attempt:
                return False
            return True
        if outbox.status != PerformanceTakeDeleteOutboxStatus.PROCESSING:
            return False
        if attempt is not None and outbox.attempt_count != attempt:
            return False
        now = utc_now_naive()
        outbox.status = PerformanceTakeDeleteOutboxStatus.COMPLETED
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
        if outbox.status != PerformanceTakeDeleteOutboxStatus.PROCESSING:
            return False
        if attempt is not None and outbox.attempt_count != attempt:
            return False
        now = utc_now_naive()
        delay = exponential_retry_delay_seconds(
            base_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_RETRY_BASE_SECONDS,
            attempt_count=outbox.attempt_count,
        )
        outbox.status = PerformanceTakeDeleteOutboxStatus.FAILED
        outbox.next_attempt_at = now + timedelta(seconds=delay)
        outbox.last_error = error[:4000]
        outbox.updated_at = now
        return True

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
        cleanup_candidate_ids = list(
            db.execute(
                select(PerformanceTakeUploadAuthorization.id)
                .where(
                    or_(
                        (
                            PerformanceTakeUploadAuthorization.expires_at <= now
                        )
                        & PerformanceTakeUploadAuthorization.status.in_(
                            [
                                PerformanceTakeUploadAuthorizationStatus.AUTHORIZED,
                            ]
                        ),
                        (
                            PerformanceTakeUploadAuthorization.status
                            == PerformanceTakeUploadAuthorizationStatus.FINALIZING
                        )
                        & (
                            PerformanceTakeUploadAuthorization.finalizing_expires_at
                            <= now
                        ),
                        (
                            PerformanceTakeUploadAuthorization.staging_cleanup_completed_at
                            .is_(None)
                        )
                        & (
                            PerformanceTakeUploadAuthorization.staging_cleanup_after
                            <= now
                        )
                        & PerformanceTakeUploadAuthorization.status.in_(
                            [
                                PerformanceTakeUploadAuthorizationStatus.CANCELLED,
                                PerformanceTakeUploadAuthorizationStatus.EXPIRED,
                                PerformanceTakeUploadAuthorizationStatus.ARCHIVED,
                            ]
                        ),
                        (
                            PerformanceTakeUploadAuthorization.final_cleanup_completed_at
                            .is_(None)
                        )
                        & PerformanceTakeUploadAuthorization.status.in_(
                            [
                                PerformanceTakeUploadAuthorizationStatus.CANCELLED,
                                PerformanceTakeUploadAuthorizationStatus.EXPIRED,
                            ]
                        ),
                        PerformanceTakeUploadAuthorization.orphan_final_object_keys.is_not(None),
                    ),
                )
                .order_by(PerformanceTakeUploadAuthorization.created_at)
            ).scalars()
        )

        cleaned_count = 0
        for auth_id in cleanup_candidate_ids:
            target, cleaned_auth = self._prepare_authorization_cleanup(
                db,
                auth_id,
                storage_usage_service,
                now=now,
            )
            db.commit()
            if target is None:
                continue

            cleanup_result = self._delete_authorization_cleanup_objects(storage, target)
            if cleanup_result.staging_absent_confirmed and target.can_finalize_staging_cleanup:
                with db.begin():
                    self._mark_authorization_staging_cleanup_completed(
                        db,
                        target.authorization_id,
                        now=utc_now_naive(),
                    )
            if cleanup_result.final_absent_confirmed and target.can_finalize_final_cleanup:
                with db.begin():
                    self._mark_authorization_final_cleanup_completed(
                        db,
                        target.authorization_id,
                        now=utc_now_naive(),
                    )
            if cleanup_result.absent_orphan_final_object_keys:
                with db.begin():
                    self._remove_authorization_orphan_final_keys(
                        db,
                        target.authorization_id,
                        cleanup_result.absent_orphan_final_object_keys,
                    )
            if cleaned_auth or cleanup_result.touched_storage:
                cleaned_count += 1

        return cleaned_count

    def _prepare_authorization_cleanup(
        self,
        db: Session,
        authorization_id: int,
        storage_usage_service: StorageUsageService,
        *,
        now,
    ) -> tuple[AuthorizationCleanupTarget | None, bool]:
        auth = db.execute(
            select(PerformanceTakeUploadAuthorization)
            .where(
                PerformanceTakeUploadAuthorization.id == authorization_id,
            )
            .with_for_update()
        ).scalar_one_or_none()
        if auth is None:
            return None, False

        cleaned_auth = False
        take = db.execute(
            select(PerformanceTake).where(
                PerformanceTake.user_id == auth.user_id,
                PerformanceTake.client_request_id == auth.client_request_id,
            )
        ).scalar_one_or_none()

        if (
            auth.status == PerformanceTakeUploadAuthorizationStatus.AUTHORIZED
            and take is not None
        ):
            auth.status = PerformanceTakeUploadAuthorizationStatus.ARCHIVED
            auth.staging_cleanup_after = max(
                value
                for value in [
                    auth.staging_cleanup_after,
                    auth.last_put_url_expires_at,
                    now,
                ]
                if value is not None
            )
            auth.updated_at = now

        if auth.status == PerformanceTakeUploadAuthorizationStatus.AUTHORIZED:
            auth.status = PerformanceTakeUploadAuthorizationStatus.EXPIRED
            auth.staging_cleanup_after = max(
                value
                for value in [
                    auth.staging_cleanup_after,
                    auth.last_put_url_expires_at,
                    now,
                ]
                if value is not None
            )
            auth.updated_at = now
            storage_usage_service.release_reservation_sync(
                db, auth.reservation_id, auto_commit=False
            )
            cleaned_auth = True
        elif auth.status == PerformanceTakeUploadAuthorizationStatus.FINALIZING:
            if auth.finalizing_expires_at and auth.finalizing_expires_at > now:
                return None, False
            if auth.finalizing_object_key:
                orphan_keys = _load_orphan_final_keys(auth.orphan_final_object_keys)
                if auth.finalizing_object_key not in orphan_keys:
                    orphan_keys.append(auth.finalizing_object_key)
                    auth.orphan_final_object_keys = _dump_orphan_final_keys(orphan_keys)
                    auth.final_cleanup_completed_at = None
            if take is not None:
                auth.status = PerformanceTakeUploadAuthorizationStatus.ARCHIVED
                auth.finalizing_token = None
                auth.finalizing_expires_at = None
                auth.finalizing_object_key = None
                auth.staging_cleanup_after = max(
                    value
                    for value in [
                        auth.staging_cleanup_after,
                        auth.last_put_url_expires_at,
                        now,
                    ]
                    if value is not None
                )
                auth.updated_at = now
                cleaned_auth = True
            elif auth.expires_at <= now:
                auth.status = PerformanceTakeUploadAuthorizationStatus.EXPIRED
                auth.finalizing_token = None
                auth.finalizing_expires_at = None
                auth.finalizing_object_key = None
                auth.staging_cleanup_after = max(
                    value
                    for value in [
                        auth.staging_cleanup_after,
                        auth.last_put_url_expires_at,
                        now,
                    ]
                    if value is not None
                )
                auth.updated_at = now
                storage_usage_service.release_reservation_sync(
                    db, auth.reservation_id, auto_commit=False
                )
                cleaned_auth = True
            else:
                auth.status = PerformanceTakeUploadAuthorizationStatus.AUTHORIZED
                auth.finalizing_token = None
                auth.finalizing_expires_at = None
                auth.finalizing_object_key = None
                auth.updated_at = now
                return None, True

        can_cleanup_staging = (
            auth.staging_cleanup_completed_at is None
            and auth.staging_cleanup_after is not None
            and auth.staging_cleanup_after <= now
            and auth.status
            in {
                PerformanceTakeUploadAuthorizationStatus.CANCELLED,
                PerformanceTakeUploadAuthorizationStatus.EXPIRED,
                PerformanceTakeUploadAuthorizationStatus.ARCHIVED,
            }
        )
        can_cleanup_final = (
            auth.final_cleanup_completed_at is None
            and take is None
            and auth.status
            in {
                PerformanceTakeUploadAuthorizationStatus.CANCELLED,
                PerformanceTakeUploadAuthorizationStatus.EXPIRED,
            }
        )
        orphan_final_keys = tuple(_load_orphan_final_keys(auth.orphan_final_object_keys))

        return (
            AuthorizationCleanupTarget(
                authorization_id=auth.id,
                status=auth.status,
                staging_object_key=auth.staging_object_key,
                final_object_key=auth.final_object_key,
                orphan_final_object_keys=orphan_final_keys,
                delete_final_without_take=(
                    take is None
                    and auth.status
                    in {
                        PerformanceTakeUploadAuthorizationStatus.CANCELLED,
                        PerformanceTakeUploadAuthorizationStatus.EXPIRED,
                    }
                ),
                can_finalize_staging_cleanup=can_cleanup_staging,
                can_finalize_final_cleanup=can_cleanup_final,
            ),
            cleaned_auth,
        )

    @staticmethod
    def _delete_authorization_cleanup_objects(
        storage: FileStorage,
        target: AuthorizationCleanupTarget,
    ) -> AuthorizationCleanupResult:
        try:
            staging_deleted = False
            staging_absent_confirmed = False
            final_deleted = False
            final_absent_confirmed = False
            absent_orphan_keys: list[str] = []
            if (
                storage is not None
                and target.can_finalize_staging_cleanup
            ):
                if storage.exists(target.staging_object_key):
                    staging_deleted = bool(storage.delete(target.staging_object_key))
                staging_absent_confirmed = not storage.exists(target.staging_object_key)

            if (
                storage is not None
                and target.can_finalize_final_cleanup
            ):
                if storage.exists(target.final_object_key):
                    final_deleted = bool(storage.delete(target.final_object_key))
                final_absent_confirmed = not storage.exists(target.final_object_key)

            if storage is not None and target.orphan_final_object_keys:
                for orphan_key in target.orphan_final_object_keys:
                    if storage.exists(orphan_key):
                        storage.delete(orphan_key)
                        if not storage.exists(orphan_key):
                            absent_orphan_keys.append(orphan_key)

            return AuthorizationCleanupResult(
                staging_absent_confirmed=staging_absent_confirmed,
                staging_deleted=staging_deleted,
                final_absent_confirmed=final_absent_confirmed,
                final_deleted=final_deleted,
                absent_orphan_final_object_keys=tuple(absent_orphan_keys),
            )
        except Exception:
            logger.exception(
                "performance_take_upload_authorization.cleanup_object_delete_failed",
                extra={
                    "authorization_id": target.authorization_id,
                    "status": target.status,
                    "staging_object_key": target.staging_object_key,
                    "final_object_key": target.final_object_key,
                },
            )
            return AuthorizationCleanupResult()

    @staticmethod
    def _mark_authorization_staging_cleanup_completed(
        db: Session,
        authorization_id: int,
        *,
        now,
    ) -> bool:
        auth = db.execute(
            select(PerformanceTakeUploadAuthorization)
            .where(PerformanceTakeUploadAuthorization.id == authorization_id)
            .with_for_update()
        ).scalar_one_or_none()
        if auth is None:
            return False
        if (
            auth.staging_cleanup_completed_at is not None
            or auth.staging_cleanup_after is None
            or auth.staging_cleanup_after > now
            or auth.status
            not in {
                PerformanceTakeUploadAuthorizationStatus.CANCELLED,
                PerformanceTakeUploadAuthorizationStatus.EXPIRED,
                PerformanceTakeUploadAuthorizationStatus.ARCHIVED,
            }
        ):
            return False
        auth.staging_cleanup_completed_at = now
        auth.updated_at = now
        return True

    @staticmethod
    def _mark_authorization_final_cleanup_completed(
        db: Session,
        authorization_id: int,
        *,
        now,
    ) -> bool:
        auth = db.execute(
            select(PerformanceTakeUploadAuthorization)
            .where(PerformanceTakeUploadAuthorization.id == authorization_id)
            .with_for_update()
        ).scalar_one_or_none()
        if auth is None:
            return False
        if (
            auth.final_cleanup_completed_at is not None
            or auth.status
            not in {
                PerformanceTakeUploadAuthorizationStatus.CANCELLED,
                PerformanceTakeUploadAuthorizationStatus.EXPIRED,
            }
        ):
            return False
        auth.final_cleanup_completed_at = now
        auth.updated_at = now
        return True

    @staticmethod
    def _remove_authorization_orphan_final_keys(
        db: Session,
        authorization_id: int,
        absent_keys: tuple[str, ...],
    ) -> bool:
        auth = db.execute(
            select(PerformanceTakeUploadAuthorization)
            .where(PerformanceTakeUploadAuthorization.id == authorization_id)
            .with_for_update()
        ).scalar_one_or_none()
        if auth is None:
            return False
        current = _load_orphan_final_keys(auth.orphan_final_object_keys)
        remaining = [key for key in current if key not in set(absent_keys)]
        if len(remaining) == len(current):
            return False
        auth.orphan_final_object_keys = _dump_orphan_final_keys(remaining)
        auth.updated_at = utc_now_naive()
        return True

    @staticmethod
    def _get(
        db: Session,
        outbox_uuid: str,
        *,
        lock: bool = False,
    ) -> PerformanceTakeDeleteOutbox | None:
        statement = select(PerformanceTakeDeleteOutbox).where(
            PerformanceTakeDeleteOutbox.outbox_uuid == outbox_uuid
        )
        if lock:
            statement = statement.with_for_update()
        return db.execute(statement).scalar_one_or_none()

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
