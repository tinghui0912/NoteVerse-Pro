from __future__ import annotations
from app.db.models.performance_take_manifest import PerformanceTakeMediaKind

from app.modules.performance_takes.upload_reservation.domain import UploadReservationStatus

import asyncio
from dataclasses import asdict
from datetime import datetime, timedelta
import hashlib
import hmac
from time import monotonic
from uuid import uuid4

from sqlalchemy import select
from app.db.models.score import Score, ScoreDeletionStatus
from app.modules.storage_objects.facts import StoredObjectFacts
from app.modules.storage_objects.persistence import object_to_row
from app.modules.performance_takes.aggregate import SavedTakeFacts
from app.modules.performance_takes.manifest import (
    TakeManifest,
    SUPPORTED_AUDIO_MIMES,
    SUPPORTED_VIDEO_MIMES,
)
from app.modules.performance_takes.manifest_persistence import (
    manifest_from_row,
    manifest_to_row,
    canonical_manifest_json,
)
from sqlalchemy.exc import DBAPIError, InterfaceError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.logger import logger
from app.core.exceptions import (
    ExternalServiceException,
    ResourceNotFoundException,
    ValidationException,
)
from app.db.session import AsyncSessionLocal
from app.db.models.performance_take import (
    PerformanceTake,
)
from app.db.models.performance_take_upload_reservation import (
    PerformanceTakeUploadReservation,
)
from app.db.models.storage_usage import StorageUsageCategory
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.performance_takes.upload_reservation.domain import (
    FinalizeLease,
    ReservationTransition,
    ReservationTransitionError,
)
from app.modules.performance_takes.upload_reservation.persistence import (
    lifecycle_from_row,
    apply_transition,
    initialize_lifecycle,
)
from app.modules.performance_takes.upload_reservation.domain import UploadReservationLifecycle
from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.performance_takes.schemas import (
    PerformanceTakeManifestRead,
    PerformanceTakeRead,
    PerformanceTakeTempoPlan,
    PerformanceTakeUploadReservationRead,
    PerformanceTakeUploadReservationRequest,
    PerformanceTakeUploadMetadata,
    PerformanceTakeUploadTarget,
)
from app.modules.practice.bundle.service import PracticeBundleService
from app.modules.practice.planning.score_plan import (
    PlanningMoment,
    PracticePlanningScore,
    FullScopeSelection,
    RangeScopeSelection,
    ScoreTempoSelection,
    CustomTempoSelection,
    PracticePlanningError,
    resolve_practice_score_plan,
)
from app.modules.practice.score.domain import PracticeTempoSegment

from app.modules.score_access.policy import ScoreAccessPolicy
from app.modules.storage_usage.service import StorageUsageService
from app.shared.constants import ErrorCode
from app.storage.base import ObjectStorage
from app.storage.factory import object_storage
from app.utils.timezone import utc_now_naive

MAX_TAKE_MEDIA_BYTES = 100 * 1024 * 1024
MAX_TAKE_DURATION_US = 12 * 60 * 60 * 1_000_000
TAKE_UPLOAD_RESERVATION_SECONDS = 3600
TAKE_FINALIZING_LEASE_SECONDS = 15 * 60


def _status_value(status: object) -> str:
    value = getattr(status, "value", status)
    return str(value)


def _media_kind_value(media_kind: object) -> str:
    value = getattr(media_kind, "value", media_kind)
    return str(value or PerformanceTakeMediaKind.AUDIO.value).upper()


def _clean_mime_type(mime_type: str) -> str:
    return mime_type.split(";")[0].strip().lower()


def _supported_mimes_for_kind(media_kind: str) -> frozenset[str]:
    if media_kind == PerformanceTakeMediaKind.VIDEO.value:
        return SUPPORTED_VIDEO_MIMES
    return SUPPORTED_AUDIO_MIMES


def _extension_for_mime(mime_type: str) -> str:
    cleaned = mime_type.split(";")[0].strip().lower()
    mapping = {
        "audio/webm": "webm",
        "audio/mp4": "mp4",
        "audio/ogg": "ogg",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "video/webm": "webm",
        "video/mp4": "mp4",
    }
    return mapping.get(cleaned, "webm")


def _build_staging_object_key(user_id: int, take_uuid: str, mime_type: str) -> str:
    ext = _extension_for_mime(mime_type)
    return f"staging/performance-takes/{user_id}/{take_uuid}/recording.{ext}"


def _build_final_candidate_object_key(
    user_id: int,
    take_uuid: str,
    finalizing_token: str,
    mime_type: str,
) -> str:
    ext = _extension_for_mime(mime_type)
    return f"performance-takes/{user_id}/{take_uuid}/{finalizing_token}.{ext}"


def _verify_container_magic_bytes(header_bytes: bytes, mime_type: str, media_kind: str) -> bool:
    cleaned = _clean_mime_type(mime_type)
    if len(header_bytes) < 4:
        return False
    if cleaned in ("audio/webm", "video/webm"):
        return header_bytes.startswith(b"\x1a\x45\xdf\xa3")
    if cleaned == "audio/ogg":
        return header_bytes.startswith(b"OggS")
    if cleaned in ("audio/wav", "audio/x-wav"):
        if len(header_bytes) < 12:
            return False
        return header_bytes.startswith(b"RIFF") and header_bytes[8:12] == b"WAVE"
    if cleaned in ("audio/mp4", "video/mp4"):
        if len(header_bytes) >= 8 and header_bytes[4:8] == b"ftyp":
            return True
        return False
    return False


def _sha256_storage_object(storage: ObjectStorage, key: str) -> str:
    digest = hashlib.sha256()
    for chunk in storage.iter_bytes(key, chunk_size=1024 * 1024):
        digest.update(chunk)
    return digest.hexdigest()


def _safe_compare_digest(left: str, right: str) -> bool:
    return hmac.compare_digest(left.lower(), right.lower())


def _is_transient_db_disconnect(error: BaseException) -> bool:
    if isinstance(error, DBAPIError) and error.connection_invalidated:
        return True
    if isinstance(error, InterfaceError):
        message = str(error).lower()
        return "connection is closed" in message or "connection closed" in message
    return False


class PerformanceTakeUploadService:
    def __init__(
        self,
        repository: PerformanceTakeRepository | None = None,
        storage: ObjectStorage | None = None,
        storage_usage_service: StorageUsageService | None = None,
        score_access_policy: ScoreAccessPolicy | None = None,
        practice_bundle_service: PracticeBundleService | None = None,
    ) -> None:
        self.repository = repository or PerformanceTakeRepository()
        self.takes = PerformanceTakeService(
            repository=repository,
            storage=storage,
            score_access_policy=score_access_policy,
        )
        self.storage = storage or object_storage
        self.storage_usage_service = storage_usage_service or StorageUsageService()
        self.score_access_policy = score_access_policy or ScoreAccessPolicy()
        self.practice_bundle_service = practice_bundle_service or PracticeBundleService(
            access_policy=self.score_access_policy,
            storage=storage,
        )

    def _reservation_read(
        self,
        reservation: PerformanceTakeUploadReservation,
        *,
        upload_target=None,
        take: PerformanceTakeRead | None = None,
    ) -> PerformanceTakeUploadReservationRead:
        return PerformanceTakeUploadReservationRead(
            reservation_id=reservation.reservation_uuid,
            take_id=manifest_from_row(reservation.manifest).take_uuid,
            status=reservation.status,
            manifest=manifest_from_row(reservation.manifest).snapshot,
            upload_target=PerformanceTakeUploadTarget(
                url=upload_target.upload_url,
                method=upload_target.upload_method,
                headers=upload_target.upload_headers,
                expires_in=settings.OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS,
            )
            if upload_target is not None
            else None,
            take=take,
        )

    async def _completed_reservation_response(
        self,
        db: AsyncSession,
        reservation: PerformanceTakeUploadReservation,
        take: PerformanceTake,
    ) -> PerformanceTakeUploadReservationRead:
        return self._reservation_read(
            reservation,
            take=await self.takes.get_take(db, take.manifest.user_id, take.manifest.take_uuid),
        )

    async def _apply(
        self,
        db: AsyncSession,
        reservation: PerformanceTakeUploadReservation,
        transition: ReservationTransition,
        *,
        now: datetime,
    ) -> None:
        apply_transition(reservation, transition, now=now)
        effects = transition.effects
        if effects.release_storage_reservation:
            await self.storage_usage_service.release_reservation(
                db, reservation.storage_reservation_id, auto_commit=False
            )
        if effects.commit_storage_object_key is not None:
            await self.storage_usage_service.commit_reservation(
                db,
                reservation_id=reservation.storage_reservation_id,
                object_type="performance_take",
                object_id=reservation.manifest.take_uuid,
                storage_key=effects.commit_storage_object_key,
                auto_commit=False,
            )

    def _put_url_expires_at(self, now: datetime) -> datetime:
        return now + timedelta(seconds=settings.OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS)

    async def _ensure_finalize_copy_lease(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        take_uuid: str,
        finalizing_token: str,
    ) -> None:
        reservation = await self.repository.get_reservation_by_take_uuid(
            db,
            user_id,
            take_uuid,
            lock=True,
        )
        now = utc_now_naive()
        try:
            if reservation is None:
                raise ReservationTransitionError("finalize_lease_lost")
            lifecycle_from_row(reservation).require_current_lease(token=finalizing_token, now=now)
        except ReservationTransitionError as error:
            await db.commit()
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": "FINALIZING", "reason": "finalize_lease_lost"},
            ) from error
        await db.commit()

    async def _record_failed_candidate_final(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        take_uuid: str,
        candidate_key: str | None,
    ) -> None:
        if not candidate_key:
            return
        reservation = await self.repository.get_reservation_by_take_uuid(
            db,
            user_id,
            take_uuid,
            lock=True,
        )
        if reservation is None:
            await db.commit()
            return
        now = utc_now_naive()
        transition = lifecycle_from_row(reservation).remember_uncertain_candidate(
            key=candidate_key, now=now
        )
        await self._apply(db, reservation, transition, now=now)
        await db.commit()

    def _delete_candidate_final_best_effort(self, candidate_key: str | None) -> None:
        if not candidate_key or self.storage is None:
            return
        try:
            if self.storage.exists(candidate_key):
                self.storage.delete(candidate_key)
        except Exception:
            logger.opt(exception=True).error(
                "performance_take_upload.finalize_candidate_cleanup_failed"
            )

    async def _delete_candidate_final_async(self, candidate_key: str | None) -> None:
        if not candidate_key or self.storage is None:
            return
        await asyncio.to_thread(self._delete_candidate_final_best_effort, candidate_key)

    async def _recover_after_db_disconnect(
        self,
        *,
        user_id: int,
        take_uuid: str,
        finalizing_token: str,
        candidate_key: str,
    ) -> None:
        """Release a failed finalize lease without guessing the transaction outcome."""
        async with AsyncSessionLocal() as recovery_db:
            reservation = await self.repository.get_reservation_by_take_uuid(
                recovery_db, user_id, take_uuid, lock=True
            )
            existing_take = (
                await self.repository.get_by_reservation(recovery_db, user_id, reservation.id)
                if reservation is not None
                else None
            )
            if reservation is not None:
                lifecycle_from_row(reservation).assert_take_presence(existing_take is not None)
            if existing_take is not None:
                await recovery_db.commit()
                return
            if (
                reservation is None
                or _status_value(reservation.status) != UploadReservationStatus.FINALIZING.value
                or reservation.finalizing_token != finalizing_token
            ):
                await recovery_db.commit()
                return
            now = utc_now_naive()
            transition = lifecycle_from_row(reservation).recover_finalize(
                token=finalizing_token, object_key=candidate_key, now=now, unknown_outcome=True
            )
            await self._apply(recovery_db, reservation, transition, now=now)
            await recovery_db.commit()

    async def _expire_reservation(
        self,
        db: AsyncSession,
        reservation: PerformanceTakeUploadReservation,
    ) -> str:
        now = utc_now_naive()
        await self._apply(db, reservation, lifecycle_from_row(reservation).expire(now=now), now=now)
        await db.commit()
        return reservation.staging_object_key

    async def _replay_reservation(
        self,
        db: AsyncSession,
        reservation: PerformanceTakeUploadReservation,
        metadata: PerformanceTakeUploadMetadata,
    ) -> PerformanceTakeUploadReservationRead:
        state = lifecycle_from_row(reservation)
        status = state.status.value
        completed_take = await self.repository.get_by_reservation(
            db, reservation.user_id, reservation.id
        )
        state.assert_take_presence(completed_take is not None)
        if status not in {
            UploadReservationStatus.RESERVED.value,
            UploadReservationStatus.FINALIZING.value,
            UploadReservationStatus.COMPLETED.value,
        }:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": f"client_request_id_{status.lower()}"},
            )
        if not manifest_from_row(reservation.manifest).agrees_with(metadata):
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": "client_request_id_reuse_conflict"},
            )
        if completed_take is not None:
            return await self._completed_reservation_response(db, reservation, completed_take)
        if status == UploadReservationStatus.FINALIZING.value:
            return self._reservation_read(reservation)
        if status != UploadReservationStatus.RESERVED.value:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": f"client_request_id_{status.lower()}"},
            )
        if reservation.expires_at <= utc_now_naive():
            await self._expire_reservation(db, reservation)
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": "client_request_id_expired_use_new_id"},
            )
        upload_target = self.storage.upload_url(
            key=reservation.staging_object_key,
            content_type=manifest_from_row(reservation.manifest).snapshot.capture.mime_type,
            checksum_sha256="",
        )
        now = utc_now_naive()
        await self._apply(
            db,
            reservation,
            lifecycle_from_row(reservation).refresh_upload(
                now=now, put_expires_at=self._put_url_expires_at(now)
            ),
            now=now,
        )
        response = self._reservation_read(reservation, upload_target=upload_target)
        await db.commit()
        return response

    async def reserve_upload(
        self,
        db: AsyncSession,
        user_id: int,
        request: PerformanceTakeUploadReservationRequest,
    ) -> PerformanceTakeUploadReservationRead:
        metadata = PerformanceTakeUploadMetadata.model_validate(
            request.model_dump(exclude={"client_request_id"})
        )
        media = metadata.media
        media = media.model_copy(update={"mime_type": _clean_mime_type(media.mime_type)})
        metadata = metadata.model_copy(update={"media": media})
        if media.mime_type not in _supported_mimes_for_kind(media.kind):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")
        if metadata.recording_timebase.nominalMediaDurationUs > MAX_TAKE_DURATION_US:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="recording_timebase")
        if not 0 < media.byte_size <= MAX_TAKE_MEDIA_BYTES:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")
        canonical_manifest_json(metadata.tempo_selection.model_dump(mode="json"))
        canonical_manifest_json(metadata.recording_timebase.model_dump(mode="json"))
        existing = await self.repository.get_reservation_by_client_request_id(
            db,
            user_id,
            request.client_request_id,
            lock=True,
        )
        if existing is not None:
            return await self._replay_reservation(db, existing, metadata)
        authorized_bundle = await self.practice_bundle_service.authorize_bundle_for_save(
            db,
            user_id,
            metadata.practice_binding.score_id,
            metadata.practice_binding.revision_id,
            metadata.practice_binding.bundle_id,
        )
        bundle_ref = authorized_bundle.bundle_ref
        artifact = authorized_bundle.bundle.artifact.value
        score = PracticePlanningScore(
            tuple(
                PlanningMoment(moment["groupId"], moment["onsetTick"], moment["canonicalEndTick"])
                for moment in artifact["moments"]
            ),
            artifact["scoreEndTick"],
            tuple(
                PracticeTempoSegment(segment["startTick"], segment["bpm"])
                for segment in artifact["scoreTempoSegments"]
            ),
            artifact["ticksPerQuarter"],
        )
        scope_selection = (
            FullScopeSelection()
            if metadata.scope.kind == "FULL"
            else RangeScopeSelection(metadata.scope.start_group_id, metadata.scope.end_group_id)
        )
        tempo_selection = (
            ScoreTempoSelection()
            if metadata.tempo_selection.mode == "SCORE"
            else CustomTempoSelection(metadata.tempo_selection.bpm)
        )
        try:
            plan = resolve_practice_score_plan(score, scope_selection, tempo_selection)
        except PracticePlanningError as error:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field=error.field) from error
        tempo_plan = PerformanceTakeTempoPlan.model_validate(
            {
                "selection": asdict(plan.tempo_plan.selection),
                "segments": [
                    {"startTick": segment.start_tick, "bpm": segment.bpm, "source": segment.source}
                    for segment in plan.tempo_plan.segments
                ],
            }
        )
        take_uuid = str(uuid4())
        staging_key = _build_staging_object_key(user_id, take_uuid, media.mime_type)
        upload_target = self.storage.upload_url(
            key=staging_key, content_type=media.mime_type, checksum_sha256=""
        )
        storage_reservation = await self.storage_usage_service.reserve(
            db,
            user_id=user_id,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=media.byte_size,
            reason="performance_take_upload_reservation",
            object_type="performance_take",
            object_id=take_uuid,
            storage_key=staging_key,
            auto_commit=False,
        )
        now = utc_now_naive()
        put_expiry = self._put_url_expires_at(now)
        manifest = TakeManifest(
            take_uuid,
            user_id,
            PerformanceTakeManifestRead.model_validate(
                {
                    "practice_binding": {
                        "bundle_id": bundle_ref.bundle_id,
                        "score_id": authorized_bundle.score_uuid,
                        "revision_id": authorized_bundle.revision_uuid,
                    },
                    "artifact_id": bundle_ref.artifact_id,
                    "score_title_snapshot": authorized_bundle.score_title,
                    "capture": media,
                    "score_timebase": {"ticks_per_quarter": score.ticks_per_quarter},
                    "scope": {
                        key: value for key, value in asdict(plan.scope).items() if value is not None
                    },
                    "tempo_plan": tempo_plan,
                    "recording_timebase": metadata.recording_timebase,
                }
            ),
        )
        manifest_row = manifest_to_row(manifest)
        reservation = PerformanceTakeUploadReservation(
            user_id=user_id,
            client_request_id=request.client_request_id,
            staging_object_key=staging_key,
            storage_reservation_id=storage_reservation.reservation_id,
            expires_at=now + timedelta(seconds=TAKE_UPLOAD_RESERVATION_SECONDS),
        )
        initialize_lifecycle(
            reservation,
            UploadReservationLifecycle.reserved(
                expires_at=now + timedelta(seconds=TAKE_UPLOAD_RESERVATION_SECONDS),
                put_expires_at=put_expiry,
            ),
        )
        try:
            await self.repository.create_manifest(db, manifest_row)
            reservation.manifest_id = manifest_row.id
            reservation.manifest = manifest_row
            await self.repository.create_reservation(db, reservation, auto_commit=False)
            response = self._reservation_read(reservation, upload_target=upload_target)
            await db.commit()
        except IntegrityError:
            await db.rollback()
            winner = await self.repository.get_reservation_by_client_request_id(
                db,
                user_id,
                request.client_request_id,
                lock=True,
            )
            if winner is None:
                raise
            return await self._replay_reservation(db, winner, metadata)
        except Exception:
            await db.rollback()
            raise
        return response

    async def cancel_upload_reservation(
        self,
        db: AsyncSession,
        user_id: int,
        reservation_id: str,
    ) -> None:
        reservation = await self.repository.get_reservation_by_uuid(
            db, user_id, reservation_id, lock=True
        )
        if reservation is None:
            raise ResourceNotFoundException("upload_reservation", reservation_id)
        now = utc_now_naive()
        state = lifecycle_from_row(reservation)
        take = await self.repository.get_by_reservation(db, user_id, reservation.id)
        state.assert_take_presence(take is not None, allow_deleted_take=True)
        try:
            transition = state.cancel(now=now)
        except ReservationTransitionError as error:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR, field="status", details={"reason": error.code}
            ) from error
        await self._apply(db, reservation, transition, now=now)
        await db.commit()

    async def finalize_take(
        self,
        db: AsyncSession,
        user_id: int,
        reservation_id: str,
    ) -> PerformanceTakeRead:
        finalize_started = monotonic()

        def log_stage(stage: str, *, started_at: float) -> None:
            logger.info(
                "performance_take.finalize.stage",
                extra={
                    "take_uuid": take_uuid,
                    "stage": stage,
                    "elapsed_ms": round((monotonic() - started_at) * 1000, 1),
                    "media_kind": manifest.snapshot.capture.kind,
                    "media_byte_size": manifest.snapshot.capture.byte_size,
                },
            )

        reservation = await self.repository.get_reservation_by_uuid(
            db,
            user_id,
            reservation_id,
            lock=True,
        )
        if reservation is None:
            raise ResourceNotFoundException("upload_reservation", reservation_id)
        manifest = manifest_from_row(reservation.manifest)
        take_uuid = manifest.take_uuid
        existing_take = await self.repository.get_by_reservation(db, user_id, reservation.id)
        lifecycle_from_row(reservation).assert_take_presence(existing_take is not None)
        if existing_take is not None:
            response = await self._completed_reservation_response(db, reservation, existing_take)
            await db.commit()
            assert response.take is not None
            return response.take
        now = utc_now_naive()
        if _status_value(reservation.status) == UploadReservationStatus.COMPLETED.value:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"reason": "completed_reservation_missing_take"},
            )

        finalizing_token = str(uuid4())
        finalizing_object_key = _build_final_candidate_object_key(
            reservation.user_id,
            manifest.take_uuid,
            finalizing_token,
            manifest.snapshot.capture.mime_type,
        )
        state = lifecycle_from_row(reservation)
        try:
            transition = state.begin_finalize(
                lease=FinalizeLease(
                    finalizing_token,
                    finalizing_object_key,
                    now + timedelta(seconds=TAKE_FINALIZING_LEASE_SECONDS),
                ),
                now=now,
            )
        except ReservationTransitionError as error:
            if error.code == "reservation_expired":
                await self._expire_reservation(db, reservation)
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR, field="reservation_expired"
                ) from error
            await db.commit()
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": state.status.value, "reason": error.code},
            ) from error
        await self._apply(db, reservation, transition, now=now)
        staging_key = reservation.staging_object_key
        reservation_expiry = reservation.expires_at
        await db.commit()
        log_stage("lease_acquired", started_at=finalize_started)

        staging_exists = await asyncio.to_thread(self.storage.exists, staging_key)
        if reservation_expiry < now:
            reservation = await self.repository.get_reservation_by_take_uuid(
                db, user_id, take_uuid, lock=True
            )
            if (
                reservation is not None
                and _status_value(reservation.status) == UploadReservationStatus.FINALIZING.value
                and reservation.finalizing_token == finalizing_token
            ):
                current_now = utc_now_naive()
                await self._apply(
                    db,
                    reservation,
                    lifecycle_from_row(reservation).expire(
                        now=current_now,
                        unknown_outcome=False,
                        token=finalizing_token,
                        object_key=finalizing_object_key,
                    ),
                    now=current_now,
                )
            await db.commit()
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="reservation_expired")

        source_key = staging_key
        if not staging_exists:
            reservation = await self.repository.get_reservation_by_take_uuid(
                db, user_id, take_uuid, lock=True
            )
            if (
                reservation is not None
                and _status_value(reservation.status) == UploadReservationStatus.FINALIZING.value
                and reservation.finalizing_token == finalizing_token
            ):
                current_now = utc_now_naive()
                await self._apply(
                    db,
                    reservation,
                    lifecycle_from_row(reservation).recover_finalize(
                        token=finalizing_token,
                        object_key=finalizing_object_key,
                        now=current_now,
                        unknown_outcome=False,
                    ),
                    now=current_now,
                )
                await db.commit()
            raise ResourceNotFoundException(
                "performance_take_media_object",
                take_uuid,
                ErrorCode.FILE_NOT_FOUND,
            )

        metadata = await asyncio.to_thread(self.storage.object_metadata, source_key)
        if metadata.size_bytes != manifest.snapshot.capture.byte_size:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")
        if (
            metadata.content_type is not None
            and metadata.content_type.split(";")[0].strip().lower()
            != manifest.snapshot.capture.mime_type
        ):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")

        header_storage = self.storage
        header_bytes = await asyncio.to_thread(
            lambda: b"".join(header_storage.iter_bytes(source_key, chunk_size=64, start=0, end=63))
        )
        if not _verify_container_magic_bytes(
            header_bytes,
            manifest.snapshot.capture.mime_type,
            manifest.snapshot.capture.kind,
        ):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")
        verified_staging_sha256 = await asyncio.to_thread(
            _sha256_storage_object,
            self.storage,
            staging_key,
        )
        log_stage("staging_verified", started_at=finalize_started)
        log_stage("staging_hash_complete", started_at=finalize_started)

        candidate_key = finalizing_object_key
        try:
            await self._ensure_finalize_copy_lease(
                db,
                user_id=user_id,
                take_uuid=take_uuid,
                finalizing_token=finalizing_token,
            )
            await asyncio.to_thread(
                self.storage.copy,
                staging_key,
                candidate_key,
            )
            candidate_metadata = await asyncio.to_thread(
                self.storage.object_metadata, candidate_key
            )
            if candidate_metadata.size_bytes != manifest.snapshot.capture.byte_size:
                raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")
            if (
                candidate_metadata.content_type is not None
                and _clean_mime_type(candidate_metadata.content_type)
                != manifest.snapshot.capture.mime_type
            ):
                raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")
            log_stage("candidate_copy_complete", started_at=finalize_started)
            candidate_sha256 = await asyncio.to_thread(
                _sha256_storage_object,
                self.storage,
                candidate_key,
            )
            if not _safe_compare_digest(candidate_sha256, verified_staging_sha256):
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR,
                    field="media_checksum",
                    details={"reason": "candidate_content_mismatch"},
                )
        except Exception:
            await self._record_failed_candidate_final(
                db,
                user_id=user_id,
                take_uuid=take_uuid,
                candidate_key=candidate_key,
            )
            await self._delete_candidate_final_async(candidate_key)
            raise
        log_stage("candidate_hash_complete", started_at=finalize_started)

        # Reconnect after a long object copy without re-authorizing admitted metadata.
        async def lock_reservation() -> PerformanceTakeUploadReservation | None:
            return await self.repository.get_reservation_by_take_uuid(
                db, user_id, take_uuid, lock=True
            )

        try:
            reservation = await lock_reservation()
        except Exception as error:
            if not _is_transient_db_disconnect(error):
                raise
            try:
                await db.rollback()
            except Exception:
                logger.debug(
                    "performance_take.finalize.db_rollback_failed_after_disconnect",
                    exc_info=True,
                )
            finally:
                await db.invalidate()
            logger.warning(
                "performance_take.finalize.db_reconnect_retry",
                extra={"take_uuid": take_uuid, "stage": "db_finalize_started"},
            )
            reservation = await lock_reservation()
        log_stage("db_finalize_started", started_at=finalize_started)
        if reservation is None:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="reservation_id")
        existing_take = await self.repository.get_by_reservation(db, user_id, reservation.id)
        lifecycle_from_row(reservation).assert_take_presence(existing_take is not None)
        if existing_take is not None:
            response = await self._completed_reservation_response(db, reservation, existing_take)
            await db.commit()
            assert response.take is not None
            return response.take
        try:
            lifecycle_from_row(reservation).require_current_lease(
                token=finalizing_token, object_key=candidate_key, now=utc_now_naive()
            )
        except ReservationTransitionError:
            await self._record_failed_candidate_final(
                db,
                user_id=user_id,
                take_uuid=take_uuid,
                candidate_key=candidate_key,
            )
            await self._delete_candidate_final_async(candidate_key)
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": _status_value(reservation.status)},
            )

        if reservation.expires_at < utc_now_naive():
            await self._delete_candidate_final_async(candidate_key)
            current_now = utc_now_naive()
            await self._apply(
                db,
                reservation,
                lifecycle_from_row(reservation).expire(
                    now=current_now,
                    unknown_outcome=False,
                    token=finalizing_token,
                    object_key=finalizing_object_key,
                ),
                now=current_now,
            )
            await db.commit()
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="reservation_expired")

        # Commit StoredObject, Take, reservation completion and quota in one transaction.
        if manifest_from_row(reservation.manifest) != manifest:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="manifest")
        current_score = (
            (
                await db.execute(
                    select(Score)
                    .where(
                        Score.score_uuid == manifest.snapshot.practice_binding.score_id,
                        Score.deletion_status == ScoreDeletionStatus.ACTIVE,
                    )
                    .with_for_update(read=True, key_share=True)
                )
            )
            .scalars()
            .first()
        )
        blob_facts = StoredObjectFacts(
            candidate_key,
            candidate_metadata.size_bytes,
            candidate_sha256,
            manifest.snapshot.capture.mime_type,
        )
        SavedTakeFacts(manifest, blob_facts)
        blob_row = object_to_row(blob_facts)
        db.add(blob_row)
        await db.flush()
        take = PerformanceTake(
            recording_object_id=blob_row.id,
            recording_object=blob_row,
            manifest_id=reservation.manifest_id,
            manifest=reservation.manifest,
            linked_score_id=current_score.id if current_score is not None else None,
        )
        await self.repository.create_take(db, take, auto_commit=False)
        current_now = utc_now_naive()
        await self._apply(
            db,
            reservation,
            lifecycle_from_row(reservation).complete(
                token=finalizing_token, object_key=candidate_key, now=current_now
            ),
            now=current_now,
        )
        try:
            await db.commit()
        except Exception as error:
            if not _is_transient_db_disconnect(error):
                raise
            try:
                await db.rollback()
            except Exception:
                logger.debug(
                    "performance_take.finalize.db_rollback_failed_after_disconnect",
                    exc_info=True,
                )
            finally:
                await db.invalidate()
            await self._recover_after_db_disconnect(
                user_id=user_id,
                take_uuid=take_uuid,
                finalizing_token=finalizing_token,
                candidate_key=candidate_key,
            )
            raise ExternalServiceException(
                "database",
                details={"retryable": True, "operation": "performance_take_finalize"},
            ) from error
        log_stage("db_finalize_committed", started_at=finalize_started)

        return await self.takes.get_take(db, user_id, take_uuid)
