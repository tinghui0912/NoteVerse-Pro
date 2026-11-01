from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timedelta
import json

from sqlalchemy import or_, select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.logger import logger
from app.db.models import (
    PerformanceTake,
    PerformanceTakeDeleteOutbox,
    PerformanceTakeDeleteOutboxStatus,
    PerformanceTakeUploadReservation,
    PerformanceTakeUploadReservationStatus,
)
from app.modules.async_operations.delivery_policy import (
    delivery_lease_expired,
    exponential_retry_delay_seconds,
)
from app.modules.practice.source.retention import (
    practice_source_delete_service,
)
from app.modules.storage_usage.service import StorageUsageService
from app.storage.base import FileStorage
from app.utils.timezone import utc_now_naive


def _status_value(status: object) -> str:
    value = getattr(status, "value", status)
    return str(value)


def _load_orphan_final_entries(value: str | None) -> list[dict[str, str | None]]:
    if not value:
        return []
    try:
        decoded = json.loads(value)
    except json.JSONDecodeError:
        return []
    if not isinstance(decoded, list):
        return []
    entries: list[dict[str, str | None]] = []
    for item in decoded:
        if isinstance(item, str) and item:
            entries.append({"key": item, "remove_after": None})
        elif isinstance(item, dict):
            key = item.get("key")
            if isinstance(key, str) and key:
                remove_after = item.get("remove_after")
                entries.append(
                    {
                        "key": key,
                        "remove_after": remove_after if isinstance(remove_after, str) else None,
                    }
                )
    return entries


def _load_orphan_final_keys(value: str | None) -> list[str]:
    return [key for entry in _load_orphan_final_entries(value) if (key := entry.get("key"))]


def _dump_orphan_final_entries(entries: list[dict[str, str | None]]) -> str | None:
    unique: list[dict[str, str | None]] = []
    seen: set[str] = set()
    for entry in entries:
        key = entry.get("key")
        if key and key not in seen:
            seen.add(key)
            unique.append({"key": key, "remove_after": entry.get("remove_after")})
    if not unique:
        return None
    return json.dumps(unique, sort_keys=True, separators=(",", ":"))


def _dump_orphan_final_keys(keys: list[str]) -> str | None:
    return _dump_orphan_final_entries([{"key": key, "remove_after": None} for key in keys])


def _parse_orphan_remove_after(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(value)
    except ValueError:
        return None


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
class ReservationCleanupTarget:
    reservation_row_id: int
    status: PerformanceTakeUploadReservationStatus
    staging_object_key: str
    final_object_key: str | None
    orphan_final_objects: tuple[dict[str, str | None], ...]
    delete_final_without_take: bool
    can_finalize_staging_cleanup: bool
    can_finalize_final_cleanup: bool


@dataclass(frozen=True)
class ReservationCleanupResult:
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
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if outbox is None or _status_value(outbox.status) in {
            PerformanceTakeDeleteOutboxStatus.PROCESSING.value,
            PerformanceTakeDeleteOutboxStatus.COMPLETED.value,
        }:
            return None
        if (
            _status_value(outbox.status) == PerformanceTakeDeleteOutboxStatus.FAILED.value
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
        outbox.status = PerformanceTakeDeleteOutboxStatus.PROCESSING.value
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
        if _status_value(outbox.status) == PerformanceTakeDeleteOutboxStatus.COMPLETED.value:
            if attempt is not None and outbox.attempt_count != attempt:
                return False
            return True
        if _status_value(outbox.status) != PerformanceTakeDeleteOutboxStatus.PROCESSING.value:
            return False
        if attempt is not None and outbox.attempt_count != attempt:
            return False
        now = utc_now_naive()
        outbox.status = PerformanceTakeDeleteOutboxStatus.COMPLETED.value
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
        if _status_value(outbox.status) != PerformanceTakeDeleteOutboxStatus.PROCESSING.value:
            return False
        if attempt is not None and outbox.attempt_count != attempt:
            return False
        now = utc_now_naive()
        delay = exponential_retry_delay_seconds(
            base_seconds=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_RETRY_BASE_SECONDS,
            attempt_count=outbox.attempt_count,
        )
        outbox.status = PerformanceTakeDeleteOutboxStatus.FAILED.value
        outbox.next_attempt_at = now + timedelta(seconds=delay)
        outbox.last_error = error[:4000]
        outbox.updated_at = now
        return True

    def mark_dispatched(self, db: Session, outbox_uuid: str) -> bool:
        outbox = self._get(db, outbox_uuid)
        if outbox is None or not self._is_dispatchable(outbox):
            return False
        now = utc_now_naive()
        outbox.status = PerformanceTakeDeleteOutboxStatus.DISPATCHED.value
        outbox.dispatched_at = now
        outbox.updated_at = now
        return True

    def release_dispatch(self, db: Session, outbox_uuid: str, error: str) -> None:
        outbox = self._get(db, outbox_uuid)
        if (
            outbox is None
            or _status_value(outbox.status) != PerformanceTakeDeleteOutboxStatus.DISPATCHED.value
        ):
            return
        outbox.status = PerformanceTakeDeleteOutboxStatus.PENDING.value
        outbox.dispatched_at = None
        outbox.last_error = error[:4000]
        outbox.updated_at = utc_now_naive()

    def recover_and_list_due(self, db: Session) -> list[str]:
        now = utc_now_naive()
        stale = db.execute(
            select(PerformanceTakeDeleteOutbox).where(
                or_(
                    PerformanceTakeDeleteOutbox.status
                    == PerformanceTakeDeleteOutboxStatus.DISPATCHED.value,
                    PerformanceTakeDeleteOutbox.status
                    == PerformanceTakeDeleteOutboxStatus.PROCESSING.value,
                )
            )
        ).scalars()
        for outbox in stale:
            if delivery_lease_expired(
                status=outbox.status,
                dispatched_status=PerformanceTakeDeleteOutboxStatus.DISPATCHED.value,
                processing_status=PerformanceTakeDeleteOutboxStatus.PROCESSING.value,
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
                outbox.status = PerformanceTakeDeleteOutboxStatus.FAILED.value
                outbox.next_attempt_at = now
                outbox.last_error = "Performance take deletion lease expired"
                outbox.updated_at = now

        due = db.execute(
            select(PerformanceTakeDeleteOutbox.outbox_uuid)
            .where(
                PerformanceTakeDeleteOutbox.status.in_(
                    [
                        PerformanceTakeDeleteOutboxStatus.PENDING.value,
                        PerformanceTakeDeleteOutboxStatus.FAILED.value,
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

    def cleanup_expired_reservations(
        self,
        db: Session,
        storage: FileStorage,
        storage_usage_service: StorageUsageService,
    ) -> int:
        now = utc_now_naive()
        cleanup_candidate_ids = list(
            db.execute(
                select(PerformanceTakeUploadReservation.id)
                .where(
                    or_(
                        (PerformanceTakeUploadReservation.expires_at <= now)
                        & PerformanceTakeUploadReservation.status.in_(
                            [
                                PerformanceTakeUploadReservationStatus.RESERVED.value,
                            ]
                        ),
                        (
                            PerformanceTakeUploadReservation.status
                            == PerformanceTakeUploadReservationStatus.FINALIZING.value
                        )
                        & (PerformanceTakeUploadReservation.finalizing_expires_at <= now),
                        (PerformanceTakeUploadReservation.staging_cleanup_completed_at.is_(None))
                        & (PerformanceTakeUploadReservation.staging_cleanup_after <= now)
                        & PerformanceTakeUploadReservation.status.in_(
                            [
                                PerformanceTakeUploadReservationStatus.CANCELLED.value,
                                PerformanceTakeUploadReservationStatus.EXPIRED.value,
                                PerformanceTakeUploadReservationStatus.COMPLETED.value,
                            ]
                        ),
                        (PerformanceTakeUploadReservation.final_cleanup_completed_at.is_(None))
                        & PerformanceTakeUploadReservation.status.in_(
                            [
                                PerformanceTakeUploadReservationStatus.CANCELLED.value,
                                PerformanceTakeUploadReservationStatus.EXPIRED.value,
                            ]
                        ),
                        PerformanceTakeUploadReservation.orphan_final_object_keys.is_not(None),
                    ),
                )
                .order_by(PerformanceTakeUploadReservation.created_at)
            ).scalars()
        )

        cleaned_count = 0
        for reservation_id in cleanup_candidate_ids:
            target, cleaned_reservation = self._prepare_reservation_cleanup(
                db,
                reservation_id,
                storage_usage_service,
                now=now,
            )
            db.commit()
            if target is None:
                continue

            cleanup_result = self._delete_reservation_cleanup_objects(storage, target)
            if cleanup_result.staging_absent_confirmed and target.can_finalize_staging_cleanup:
                with db.begin():
                    self._mark_reservation_staging_cleanup_completed(
                        db,
                        target.reservation_row_id,
                        now=utc_now_naive(),
                    )
            if cleanup_result.final_absent_confirmed and target.can_finalize_final_cleanup:
                with db.begin():
                    self._mark_reservation_final_cleanup_completed(
                        db,
                        target.reservation_row_id,
                        now=utc_now_naive(),
                    )
            if cleanup_result.absent_orphan_final_object_keys:
                with db.begin():
                    self._remove_reservation_orphan_final_keys(
                        db,
                        target.reservation_row_id,
                        cleanup_result.absent_orphan_final_object_keys,
                    )
            if cleaned_reservation or cleanup_result.touched_storage:
                cleaned_count += 1

        return cleaned_count

    def _prepare_reservation_cleanup(
        self,
        db: Session,
        reservation_row_id: int,
        storage_usage_service: StorageUsageService,
        *,
        now,
    ) -> tuple[ReservationCleanupTarget | None, bool]:
        reservation = db.execute(
            select(PerformanceTakeUploadReservation)
            .where(
                PerformanceTakeUploadReservation.id == reservation_row_id,
            )
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if reservation is None:
            return None, False

        cleaned_reservation = False
        take = db.execute(
            select(PerformanceTake).where(
                PerformanceTake.user_id == reservation.user_id,
                PerformanceTake.upload_reservation_id == reservation.id,
            )
        ).scalar_one_or_none()

        if (
            _status_value(reservation.status)
            == PerformanceTakeUploadReservationStatus.RESERVED.value
            and take is not None
        ):
            reservation.status = PerformanceTakeUploadReservationStatus.COMPLETED.value
            reservation.staging_cleanup_after = max(
                value
                for value in [
                    reservation.staging_cleanup_after,
                    reservation.last_put_url_expires_at,
                    now,
                ]
                if value is not None
            )
            reservation.updated_at = now

        if (
            _status_value(reservation.status)
            == PerformanceTakeUploadReservationStatus.RESERVED.value
        ):
            reservation.status = PerformanceTakeUploadReservationStatus.EXPIRED.value
            reservation.staging_cleanup_after = max(
                value
                for value in [
                    reservation.staging_cleanup_after,
                    reservation.last_put_url_expires_at,
                    now,
                ]
                if value is not None
            )
            reservation.updated_at = now
            storage_usage_service.release_reservation_sync(
                db, reservation.storage_reservation_id, auto_commit=False
            )
            cleaned_reservation = True
        elif (
            _status_value(reservation.status)
            == PerformanceTakeUploadReservationStatus.FINALIZING.value
        ):
            if reservation.finalizing_expires_at and reservation.finalizing_expires_at > now:
                return None, False
            if reservation.finalizing_object_key:
                orphan_entries = _load_orphan_final_entries(reservation.orphan_final_object_keys)
                orphan_keys = {entry.get("key") for entry in orphan_entries}
                if reservation.finalizing_object_key not in orphan_keys:
                    orphan_entries.append(
                        {
                            "key": reservation.finalizing_object_key,
                            "remove_after": (now + timedelta(seconds=30 * 60)).isoformat(),
                        }
                    )
                    reservation.orphan_final_object_keys = _dump_orphan_final_entries(
                        orphan_entries
                    )
                    reservation.final_cleanup_completed_at = None
            if take is not None:
                reservation.status = PerformanceTakeUploadReservationStatus.COMPLETED.value
                reservation.finalizing_token = None
                reservation.finalizing_expires_at = None
                reservation.finalizing_object_key = None
                reservation.staging_cleanup_after = max(
                    value
                    for value in [
                        reservation.staging_cleanup_after,
                        reservation.last_put_url_expires_at,
                        now,
                    ]
                    if value is not None
                )
                reservation.updated_at = now
                cleaned_reservation = True
            elif reservation.expires_at <= now:
                reservation.status = PerformanceTakeUploadReservationStatus.EXPIRED.value
                reservation.finalizing_token = None
                reservation.finalizing_expires_at = None
                reservation.finalizing_object_key = None
                reservation.staging_cleanup_after = max(
                    value
                    for value in [
                        reservation.staging_cleanup_after,
                        reservation.last_put_url_expires_at,
                        now,
                    ]
                    if value is not None
                )
                reservation.updated_at = now
                storage_usage_service.release_reservation_sync(
                    db, reservation.storage_reservation_id, auto_commit=False
                )
                cleaned_reservation = True
            else:
                reservation.status = PerformanceTakeUploadReservationStatus.RESERVED.value
                reservation.finalizing_token = None
                reservation.finalizing_expires_at = None
                reservation.finalizing_object_key = None
                reservation.updated_at = now
                return None, True

        can_cleanup_staging = (
            reservation.staging_cleanup_completed_at is None
            and reservation.staging_cleanup_after is not None
            and reservation.staging_cleanup_after <= now
            and _status_value(reservation.status)
            in {
                PerformanceTakeUploadReservationStatus.CANCELLED.value,
                PerformanceTakeUploadReservationStatus.EXPIRED.value,
                PerformanceTakeUploadReservationStatus.COMPLETED.value,
            }
        )
        can_cleanup_final = (
            reservation.final_cleanup_completed_at is None
            and take is None
            and _status_value(reservation.status)
            in {
                PerformanceTakeUploadReservationStatus.CANCELLED.value,
                PerformanceTakeUploadReservationStatus.EXPIRED.value,
            }
        )
        orphan_final_entries = tuple(
            entry
            for entry in _load_orphan_final_entries(reservation.orphan_final_object_keys)
            if not db.execute(
                select(PerformanceTake.id).where(
                    PerformanceTake.media_object_key == entry.get("key")
                )
            ).first()
        )

        if (
            _status_value(reservation.status)
            in {
                PerformanceTakeUploadReservationStatus.CANCELLED.value,
                PerformanceTakeUploadReservationStatus.EXPIRED.value,
                PerformanceTakeUploadReservationStatus.COMPLETED.value,
            }
            and reservation.practice_source_id is not None
        ):
            practice_source_id = reservation.practice_source_id
            reservation.practice_source_id = None
            reservation.updated_at = now
            practice_source_delete_service.enqueue_if_unowned(
                db,
                practice_source_id,
                storage_backend=reservation.storage_backend,
            )
            cleaned_reservation = True

        return (
            ReservationCleanupTarget(
                reservation_row_id=reservation.id,
                status=reservation.status,
                staging_object_key=reservation.staging_object_key,
                final_object_key=reservation.final_object_key,
                orphan_final_objects=orphan_final_entries,
                delete_final_without_take=(
                    take is None
                    and _status_value(reservation.status)
                    in {
                        PerformanceTakeUploadReservationStatus.CANCELLED.value,
                        PerformanceTakeUploadReservationStatus.EXPIRED.value,
                    }
                ),
                can_finalize_staging_cleanup=can_cleanup_staging,
                can_finalize_final_cleanup=can_cleanup_final,
            ),
            cleaned_reservation,
        )

    @staticmethod
    def _delete_reservation_cleanup_objects(
        storage: FileStorage,
        target: ReservationCleanupTarget,
    ) -> ReservationCleanupResult:
        try:
            staging_deleted = False
            staging_absent_confirmed = False
            final_deleted = False
            final_absent_confirmed = False
            absent_orphan_keys: list[str] = []
            if storage is not None and target.can_finalize_staging_cleanup:
                if storage.exists(target.staging_object_key):
                    staging_deleted = bool(storage.delete(target.staging_object_key))
                staging_absent_confirmed = not storage.exists(target.staging_object_key)

            if storage is not None and target.can_finalize_final_cleanup:
                if target.final_object_key is None:
                    final_absent_confirmed = True
                else:
                    if storage.exists(target.final_object_key):
                        final_deleted = bool(storage.delete(target.final_object_key))
                    final_absent_confirmed = not storage.exists(target.final_object_key)

            now = utc_now_naive()
            if storage is not None and target.orphan_final_objects:
                for orphan_entry in target.orphan_final_objects:
                    orphan_key = orphan_entry.get("key")
                    if not orphan_key:
                        continue
                    if storage.exists(orphan_key):
                        storage.delete(orphan_key)
                        if not storage.exists(orphan_key):
                            absent_orphan_keys.append(orphan_key)
                    else:
                        remove_after = _parse_orphan_remove_after(orphan_entry.get("remove_after"))
                        if remove_after is None or remove_after <= now:
                            absent_orphan_keys.append(orphan_key)

            return ReservationCleanupResult(
                staging_absent_confirmed=staging_absent_confirmed,
                staging_deleted=staging_deleted,
                final_absent_confirmed=final_absent_confirmed,
                final_deleted=final_deleted,
                absent_orphan_final_object_keys=tuple(absent_orphan_keys),
            )
        except Exception:
            logger.bind(
                resource_id=target.reservation_row_id,
                status=target.status,
            ).opt(exception=True).error(
                "performance_take_upload_reservation.cleanup_object_delete_failed"
            )
            return ReservationCleanupResult()

    @staticmethod
    def _mark_reservation_staging_cleanup_completed(
        db: Session,
        reservation_row_id: int,
        *,
        now,
    ) -> bool:
        reservation = db.execute(
            select(PerformanceTakeUploadReservation)
            .where(PerformanceTakeUploadReservation.id == reservation_row_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if reservation is None:
            return False
        if (
            reservation.staging_cleanup_completed_at is not None
            or reservation.staging_cleanup_after is None
            or reservation.staging_cleanup_after > now
            or _status_value(reservation.status)
            not in {
                PerformanceTakeUploadReservationStatus.CANCELLED.value,
                PerformanceTakeUploadReservationStatus.EXPIRED.value,
                PerformanceTakeUploadReservationStatus.COMPLETED.value,
            }
        ):
            return False
        reservation.staging_cleanup_completed_at = now
        reservation.updated_at = now
        return True

    @staticmethod
    def _mark_reservation_final_cleanup_completed(
        db: Session,
        reservation_row_id: int,
        *,
        now,
    ) -> bool:
        reservation = db.execute(
            select(PerformanceTakeUploadReservation)
            .where(PerformanceTakeUploadReservation.id == reservation_row_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if reservation is None:
            return False
        if reservation.final_cleanup_completed_at is not None or _status_value(
            reservation.status
        ) not in {
            PerformanceTakeUploadReservationStatus.CANCELLED.value,
            PerformanceTakeUploadReservationStatus.EXPIRED.value,
        }:
            return False
        reservation.final_cleanup_completed_at = now
        reservation.updated_at = now
        return True

    @staticmethod
    def _remove_reservation_orphan_final_keys(
        db: Session,
        reservation_row_id: int,
        absent_keys: tuple[str, ...],
    ) -> bool:
        reservation = db.execute(
            select(PerformanceTakeUploadReservation)
            .where(PerformanceTakeUploadReservation.id == reservation_row_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        if reservation is None:
            return False
        current_entries = _load_orphan_final_entries(reservation.orphan_final_object_keys)
        removable_keys = set(absent_keys)
        referenced_keys = set(
            db.execute(
                select(PerformanceTake.media_object_key).where(
                    PerformanceTake.media_object_key.in_(removable_keys)
                )
            ).scalars()
        )
        removable_keys -= referenced_keys
        now = utc_now_naive()
        remaining_entries: list[dict[str, str | None]] = []
        for entry in current_entries:
            key = entry.get("key")
            remove_after = _parse_orphan_remove_after(entry.get("remove_after"))
            remove_is_still_allowed = remove_after is None or remove_after <= now
            if key in removable_keys and remove_is_still_allowed:
                continue
            remaining_entries.append(entry)
        if len(remaining_entries) == len(current_entries):
            return False
        reservation.orphan_final_object_keys = _dump_orphan_final_entries(remaining_entries)
        reservation.updated_at = utc_now_naive()
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
            statement = statement.with_for_update().execution_options(populate_existing=True)
        return db.execute(statement).scalar_one_or_none()

    @staticmethod
    def _is_dispatchable(outbox: PerformanceTakeDeleteOutbox) -> bool:
        return (
            _status_value(outbox.status)
            in {
                PerformanceTakeDeleteOutboxStatus.PENDING.value,
                PerformanceTakeDeleteOutboxStatus.FAILED.value,
            }
            and outbox.attempt_count < settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS
            and outbox.next_attempt_at <= utc_now_naive()
        )


performance_take_delete_outbox_service = PerformanceTakeDeleteOutboxService()
