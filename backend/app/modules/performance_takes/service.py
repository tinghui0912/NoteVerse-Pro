from __future__ import annotations

import asyncio
from dataclasses import asdict
from datetime import datetime, timedelta
import hashlib
import hmac
import json
from time import monotonic
from typing import Optional
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, InterfaceError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

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
    PerformanceTakeDeletionStatus,
    PerformanceTakeMediaKind,
)
from app.db.models.performance_take_delete_outbox import (
    PerformanceTakeDeleteOutbox,
    PerformanceTakeDeleteOutboxStatus,
)
from app.db.models.performance_take_upload_reservation import (
    PerformanceTakeUploadReservation,
    PerformanceTakeUploadReservationStatus,
)
from app.db.models.score import Score, ScoreDeletionStatus
from app.db.models.storage_usage import StorageUsageCategory
from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.performance_takes.schemas import (
    PerformanceTakeListResponse,
    PerformanceTakePlaybackRead,
    PerformanceTakeRead,
    PerformanceTakeTempoPlan,
    PerformanceTakeUploadReservationRead,
    PerformanceTakeUploadReservationRequest,
    PerformanceTakeUploadMetadata,
    PerformanceTakeUploadTarget,
    RecordingTimebase,
)
from app.modules.practice.source.schemas import (
    PracticeSourceRead,
)
from app.modules.practice.source.service import PracticeSourceService
from app.modules.practice.source.domain import PracticeSourceRef
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

from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.storage_usage.service import StorageUsageService
from app.shared.constants import ErrorCode
from app.storage.base import FileStorage
from app.utils.timezone import utc_now_naive

SUPPORTED_AUDIO_MIMES = {
    "audio/webm",
    "audio/mp4",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
}
SUPPORTED_VIDEO_MIMES = {
    "video/webm",
}
MAX_TAKE_MEDIA_BYTES = 100 * 1024 * 1024
MAX_TAKE_DURATION_MS = 12 * 60 * 60 * 1000
MAX_TAKE_METADATA_JSON_BYTES = 64 * 1024
TAKE_UPLOAD_RESERVATION_SECONDS = 3600
TAKE_FINALIZING_LEASE_SECONDS = 15 * 60
TAKE_FINALIZING_UNKNOWN_OUTCOME_GRACE_SECONDS = TAKE_FINALIZING_LEASE_SECONDS * 2


def _status_value(status: object) -> str:
    value = getattr(status, "value", status)
    return str(value)


def _media_kind_value(media_kind: object) -> str:
    value = getattr(media_kind, "value", media_kind)
    return str(value or PerformanceTakeMediaKind.AUDIO.value).upper()


def _clean_mime_type(mime_type: str) -> str:
    return mime_type.split(";")[0].strip().lower()


def _supported_mimes_for_kind(media_kind: str) -> set[str]:
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
    if cleaned == "audio/mp4":
        if len(header_bytes) >= 8 and header_bytes[4:8] == b"ftyp":
            return True
        return False
    return False


def _json_snapshot(
    value: object | None, *, max_bytes: int = MAX_TAKE_METADATA_JSON_BYTES
) -> str | None:
    if value is None:
        return None
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json", exclude_none=True)
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > max_bytes:
        raise ValidationException(ErrorCode.VALIDATION_ERROR, field="metadata_size")
    return encoded


def _max_datetime(*values: datetime | None) -> datetime | None:
    present = [value for value in values if value is not None]
    return max(present) if present else None


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


def _append_orphan_final_key(
    value: str | None,
    key: str | None,
    *,
    unknown_outcome: bool,
    now: datetime | None = None,
) -> str | None:
    if not key:
        return value
    entries = _load_orphan_final_entries(value)
    remove_after = None
    if unknown_outcome:
        base = now or utc_now_naive()
        remove_after = (
            base + timedelta(seconds=TAKE_FINALIZING_UNKNOWN_OUTCOME_GRACE_SECONDS)
        ).isoformat()
    for entry in entries:
        if entry.get("key") == key:
            if remove_after and not entry.get("remove_after"):
                entry["remove_after"] = remove_after
            return _dump_orphan_final_entries(entries)
    entries.append({"key": key, "remove_after": remove_after})
    return _dump_orphan_final_entries(entries)


def _sha256_storage_object(storage: FileStorage, key: str) -> str:
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


class PerformanceTakeService:
    def __init__(
        self,
        repository: PerformanceTakeRepository | None = None,
        storage: FileStorage | None = None,
        storage_usage_service: StorageUsageService | None = None,
        score_access_policy: ScoreAccessPolicy | None = None,
        practice_source_service: PracticeSourceService | None = None,
    ) -> None:
        self.repository = repository or PerformanceTakeRepository()
        self.storage = storage
        self.storage_usage_service = storage_usage_service or StorageUsageService()
        self.score_access_policy = score_access_policy or ScoreAccessPolicy()
        self.practice_source_service = practice_source_service or PracticeSourceService(
            access_policy=self.score_access_policy,
            storage=storage,
        )

    def _to_read_dto(
        self,
        take: PerformanceTake,
        *,
        source_ref: PracticeSourceRef,
        score: Score | None = None,
        can_open_score: bool = False,
    ) -> PerformanceTakeRead:
        tempo_plan = PerformanceTakeTempoPlan.model_validate(json.loads(take.tempo_plan))
        recording_timebase = RecordingTimebase.model_validate(json.loads(take.recording_timebase))

        score_title_snapshot = take.score_title_snapshot
        if not score_title_snapshot:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="score_title_snapshot",
                details={"reason": "score_title_snapshot_required"},
            )
        linked_score_id = (
            score.score_uuid
            if can_open_score
            and score is not None
            and score.deletion_status == ScoreDeletionStatus.ACTIVE
            else None
        )

        scope_type = take.scope_type
        if scope_type not in {"FULL", "RANGE"}:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="scope_type",
                details={"reason": "scope_type_invalid"},
            )
        deletion_status = _status_value(take.deletion_status)

        return PerformanceTakeRead(
            take_id=take.take_uuid,
            source_id=source_ref.source_id,
            source_score_id=source_ref.source_score_uuid,
            source_revision_id=source_ref.source_revision_uuid,
            source_artifact_id=source_ref.artifact_id,
            score_title_snapshot=score_title_snapshot,
            linked_score_id=linked_score_id,
            can_open_score=linked_score_id is not None,
            media_kind=_media_kind_value(take.media_kind),
            media_mime_type=take.media_mime_type,
            media_byte_size=take.media_byte_size,
            duration_ms=take.duration_ms,
            scope_type=scope_type,
            scope_start_beat=take.scope_start_beat,
            scope_terminal_beat=take.scope_terminal_beat,
            scope_start_group_id=take.scope_start_group_id,
            scope_end_group_id=take.scope_end_group_id,
            deletion_status=deletion_status,
            tempo_plan=tempo_plan,
            recording_timebase=recording_timebase,
            created_at=take.created_at,
        )

    @staticmethod
    def _reservation_metadata(
        reservation: PerformanceTakeUploadReservation,
        source_ref: PracticeSourceRef,
    ) -> PerformanceTakeUploadMetadata:
        scope = {
            "kind": reservation.scope_type,
        }
        if reservation.scope_type == "RANGE":
            scope.update(
                start_group_id=reservation.scope_start_group_id,
                end_group_id=reservation.scope_end_group_id,
            )
        return PerformanceTakeUploadMetadata.model_validate(
            {
                "source": {"source_id": source_ref.source_id},
                "media": {
                    "kind": reservation.media_kind,
                    "byte_size": reservation.media_byte_size,
                    "mime_type": reservation.media_mime_type,
                    "duration_ms": reservation.duration_ms,
                },
                "scope": scope,
                "tempo_selection": json.loads(reservation.tempo_plan)["selection"],
                "recording_timebase": json.loads(reservation.recording_timebase),
            }
        )

    @staticmethod
    def _reservation_resolved_scope(reservation: PerformanceTakeUploadReservation) -> dict:
        scope = {
            "kind": reservation.scope_type,
            "start_beat": reservation.scope_start_beat,
            "terminal_beat": reservation.scope_terminal_beat,
        }
        if reservation.scope_type == "RANGE":
            scope.update(
                start_group_id=reservation.scope_start_group_id,
                end_group_id=reservation.scope_end_group_id,
            )
        return scope

    def _reservation_read(
        self,
        reservation: PerformanceTakeUploadReservation,
        *,
        source_ref: PracticeSourceRef,
        upload_target=None,
        take: PerformanceTakeRead | None = None,
    ) -> PerformanceTakeUploadReservationRead:
        return PerformanceTakeUploadReservationRead(
            reservation_id=reservation.reservation_uuid,
            take_id=reservation.take_uuid,
            status=reservation.status,
            metadata=self._reservation_metadata(reservation, source_ref),
            resolved_scope=self._reservation_resolved_scope(reservation),
            resolved_tempo_plan=json.loads(reservation.tempo_plan),
            upload_target=PerformanceTakeUploadTarget(
                url=upload_target.upload_url,
                method=upload_target.upload_method,
                headers=upload_target.upload_headers,
                expires_in=settings.S3_PRESIGN_EXPIRE_SECONDS,
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
        source_ref = await self.practice_source_service.require_source(db, take.practice_source_id)
        score = (
            await db.get(Score, take.linked_score_id) if take.linked_score_id is not None else None
        )
        can_open_score = await self._can_open_score(db, take.user_id, score)
        return self._reservation_read(
            reservation,
            source_ref=source_ref,
            take=self._to_read_dto(
                take,
                source_ref=source_ref,
                score=score,
                can_open_score=can_open_score,
            ),
        )

    async def _can_open_score(self, db: AsyncSession, user_id: int, score: Score | None) -> bool:
        if score is None or score.deletion_status != ScoreDeletionStatus.ACTIVE:
            return False
        try:
            await self.score_access_policy.authorize(
                db,
                score.score_uuid,
                ScoreAction.VIEW,
                user_id=user_id,
            )
            return True
        except Exception:
            return False

    def _put_url_expires_at(self, now: datetime) -> datetime:
        return now + timedelta(seconds=settings.S3_PRESIGN_EXPIRE_SECONDS)

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
        if (
            reservation is None
            or _status_value(reservation.status)
            != PerformanceTakeUploadReservationStatus.FINALIZING.value
            or reservation.finalizing_token != finalizing_token
            or reservation.finalizing_expires_at is None
            or reservation.finalizing_expires_at <= now
        ):
            await db.commit()
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": "FINALIZING", "reason": "finalize_lease_lost"},
            )
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
        keys = _load_orphan_final_keys(reservation.orphan_final_object_keys)
        if candidate_key not in keys:
            reservation.orphan_final_object_keys = _append_orphan_final_key(
                reservation.orphan_final_object_keys,
                candidate_key,
                unknown_outcome=True,
            )
            reservation.final_cleanup_completed_at = None
            reservation.updated_at = utc_now_naive()
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
            if existing_take is not None:
                await recovery_db.commit()
                return
            if (
                reservation is None
                or _status_value(reservation.status)
                != PerformanceTakeUploadReservationStatus.FINALIZING.value
                or reservation.finalizing_token != finalizing_token
            ):
                await recovery_db.commit()
                return
            reservation.orphan_final_object_keys = _append_orphan_final_key(
                reservation.orphan_final_object_keys,
                candidate_key,
                unknown_outcome=True,
            )
            reservation.status = PerformanceTakeUploadReservationStatus.RESERVED.value
            reservation.finalizing_token = None
            reservation.finalizing_expires_at = None
            reservation.finalizing_object_key = None
            reservation.final_object_key = None
            reservation.updated_at = utc_now_naive()
            await recovery_db.commit()

    async def _expire_reservation(
        self,
        db: AsyncSession,
        reservation: PerformanceTakeUploadReservation,
    ) -> str:
        now = utc_now_naive()
        practice_source_id = reservation.practice_source_id
        reservation.status = PerformanceTakeUploadReservationStatus.EXPIRED.value
        reservation.practice_source_id = None
        reservation.staging_cleanup_after = _max_datetime(
            reservation.staging_cleanup_after,
            reservation.last_put_url_expires_at,
            now,
        )
        reservation.updated_at = now
        await self.storage_usage_service.release_reservation(
            db, reservation.storage_reservation_id, auto_commit=False
        )
        await self.practice_source_service.release_source_reference(db, practice_source_id)
        await db.commit()
        return reservation.staging_object_key

    async def _replay_reservation(
        self,
        db: AsyncSession,
        reservation: PerformanceTakeUploadReservation,
        metadata: PerformanceTakeUploadMetadata,
    ) -> PerformanceTakeUploadReservationRead:
        status = _status_value(reservation.status)
        completed_take = None
        if status == PerformanceTakeUploadReservationStatus.COMPLETED.value:
            completed_take = await self.repository.get_by_reservation(
                db, reservation.user_id, reservation.id
            )
            if completed_take is None:
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR,
                    field="status",
                    details={"reason": "completed_reservation_missing_take"},
                )
            source_ref = await self.practice_source_service.require_source(
                db, completed_take.practice_source_id
            )
        elif status in {
            PerformanceTakeUploadReservationStatus.RESERVED.value,
            PerformanceTakeUploadReservationStatus.FINALIZING.value,
        }:
            source_ref = await self.practice_source_service.require_source(
                db, reservation.practice_source_id
            )
        else:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": f"client_request_id_{status.lower()}"},
            )
        if self._reservation_metadata(reservation, source_ref) != metadata:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": "client_request_id_reuse_conflict"},
            )
        if completed_take is not None:
            return await self._completed_reservation_response(db, reservation, completed_take)
        if status == PerformanceTakeUploadReservationStatus.FINALIZING.value:
            return self._reservation_read(reservation, source_ref=source_ref)
        if status != PerformanceTakeUploadReservationStatus.RESERVED.value:
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
        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")
        upload_target = self.storage.upload_url(
            key=reservation.staging_object_key,
            content_type=reservation.media_mime_type,
            checksum_sha256="",
        )
        if upload_target is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="upload_target")
        now = utc_now_naive()
        reservation.last_put_url_expires_at = self._put_url_expires_at(now)
        reservation.staging_cleanup_after = _max_datetime(
            reservation.staging_cleanup_after,
            reservation.last_put_url_expires_at,
        )
        reservation.updated_at = now
        await db.commit()
        return self._reservation_read(
            reservation, source_ref=source_ref, upload_target=upload_target
        )

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
        media.mime_type = _clean_mime_type(media.mime_type)
        if media.mime_type not in _supported_mimes_for_kind(media.kind):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")
        if not 0 < media.duration_ms <= MAX_TAKE_DURATION_MS:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="duration_ms")
        if not 0 < media.byte_size <= MAX_TAKE_MEDIA_BYTES:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")
        _json_snapshot(metadata.tempo_selection)
        _json_snapshot(metadata.recording_timebase)
        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")
        existing = await self.repository.get_reservation_by_client_request_id(
            db,
            user_id,
            request.client_request_id,
            lock=True,
        )
        if existing is not None:
            return await self._replay_reservation(db, existing, metadata)
        authorized_source = await self.practice_source_service.authorize_source_by_source_id(
            db, user_id, metadata.source.source_id
        )
        source_ref = authorized_source.source_ref
        artifact = authorized_source.source.artifact.value
        score = PracticePlanningScore(
            tuple(
                PlanningMoment(moment["groupId"], moment["onsetBeat"], moment["canonicalEndBeat"])
                for moment in artifact["moments"]
            ),
            artifact["scoreEndBeat"],
            tuple(
                PracticeTempoSegment(segment["startBeat"], segment["bpm"])
                for segment in artifact["scoreTempoSegments"]
            ),
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
                    {"startBeat": segment.start_beat, "bpm": segment.bpm, "source": segment.source}
                    for segment in plan.tempo_plan.segments
                ],
            }
        )
        take_uuid = str(uuid4())
        staging_key = _build_staging_object_key(user_id, take_uuid, media.mime_type)
        upload_target = self.storage.upload_url(
            key=staging_key, content_type=media.mime_type, checksum_sha256=""
        )
        if upload_target is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="upload_target")
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
        reservation = PerformanceTakeUploadReservation(
            user_id=user_id,
            practice_source_id=source_ref.id,
            client_request_id=request.client_request_id,
            take_uuid=take_uuid,
            linked_score_id=authorized_source.score_db_id,
            score_title=authorized_source.score_title,
            scope_type=plan.scope.kind,
            scope_start_beat=plan.scope.start_beat,
            scope_terminal_beat=plan.scope.terminal_beat,
            scope_start_group_id=plan.scope.start_group_id,
            scope_end_group_id=plan.scope.end_group_id,
            tempo_plan=_json_snapshot(tempo_plan),
            recording_timebase=_json_snapshot(metadata.recording_timebase),
            duration_ms=media.duration_ms,
            media_kind=media.kind,
            media_mime_type=media.mime_type,
            media_byte_size=media.byte_size,
            storage_backend=self.storage.backend_name,
            staging_object_key=staging_key,
            storage_reservation_id=storage_reservation.reservation_id,
            status=PerformanceTakeUploadReservationStatus.RESERVED.value,
            expires_at=now + timedelta(seconds=TAKE_UPLOAD_RESERVATION_SECONDS),
            last_put_url_expires_at=put_expiry,
            staging_cleanup_after=put_expiry,
        )
        try:
            await self.repository.create_reservation(db, reservation, auto_commit=False)
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
        return self._reservation_read(
            reservation, source_ref=source_ref, upload_target=upload_target
        )

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
        staging_key: str | None = None
        if (
            reservation is not None
            and _status_value(reservation.status)
            == PerformanceTakeUploadReservationStatus.RESERVED.value
        ):
            now = utc_now_naive()
            practice_source_id = reservation.practice_source_id
            reservation.status = PerformanceTakeUploadReservationStatus.CANCELLED.value
            reservation.practice_source_id = None
            reservation.staging_cleanup_after = _max_datetime(
                reservation.staging_cleanup_after,
                reservation.last_put_url_expires_at,
                now,
            )
            reservation.updated_at = now
            staging_key = reservation.staging_object_key
            await self.storage_usage_service.release_reservation(
                db, reservation.storage_reservation_id, auto_commit=False
            )
            await self.practice_source_service.release_source_reference(db, practice_source_id)
            await db.commit()
        if (
            staging_key is not None
            and self.storage is not None
            and reservation is not None
            and reservation.staging_cleanup_after is not None
            and reservation.staging_cleanup_after <= utc_now_naive()
        ):
            try:
                await asyncio.to_thread(self._delete_storage_object_if_exists, staging_key)
            except Exception:
                logger.bind(resource_id=reservation_id).opt(exception=True).error(
                    "performance_take_upload_reservation.cancel_staging_delete_failed"
                )

    def _delete_storage_object_if_exists(self, key: str) -> None:
        if self.storage is not None and self.storage.exists(key):
            self.storage.delete(key)

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
                    "media_kind": reservation_snapshot["media_kind"],
                    "media_byte_size": reservation_snapshot["media_byte_size"],
                    "storage_backend": self.storage.__class__.__name__
                    if self.storage is not None
                    else None,
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
        take_uuid = reservation.take_uuid
        existing_take = await self.repository.get_by_reservation(db, user_id, reservation.id)
        if existing_take is not None:
            response = await self._completed_reservation_response(db, reservation, existing_take)
            await db.commit()
            assert response.take is not None
            return response.take
        now = utc_now_naive()
        if (
            _status_value(reservation.status)
            == PerformanceTakeUploadReservationStatus.COMPLETED.value
        ):
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"reason": "completed_reservation_missing_take"},
            )

        takeover_orphan_entries = _load_orphan_final_entries(reservation.orphan_final_object_keys)
        if (
            _status_value(reservation.status)
            == PerformanceTakeUploadReservationStatus.FINALIZING.value
        ):
            if reservation.finalizing_expires_at and reservation.finalizing_expires_at > now:
                await db.commit()
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR,
                    field="status",
                    details={"status": "FINALIZING", "reason": "finalize_in_progress"},
                )
            takeover_orphan_keys = {entry.get("key") for entry in takeover_orphan_entries}
            if (
                reservation.finalizing_object_key
                and reservation.finalizing_object_key not in takeover_orphan_keys
            ):
                takeover_orphan_entries.append(
                    {
                        "key": reservation.finalizing_object_key,
                        "remove_after": (
                            now + timedelta(seconds=TAKE_FINALIZING_UNKNOWN_OUTCOME_GRACE_SECONDS)
                        ).isoformat(),
                    }
                )
        elif (
            _status_value(reservation.status)
            != PerformanceTakeUploadReservationStatus.RESERVED.value
        ):
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": _status_value(reservation.status)},
            )

        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")

        finalizing_token = str(uuid4())
        finalizing_object_key = _build_final_candidate_object_key(
            reservation.user_id,
            reservation.take_uuid,
            finalizing_token,
            reservation.media_mime_type,
        )
        reservation.status = PerformanceTakeUploadReservationStatus.FINALIZING.value
        reservation.finalizing_token = finalizing_token
        reservation.finalizing_expires_at = now + timedelta(seconds=TAKE_FINALIZING_LEASE_SECONDS)
        reservation.finalizing_object_key = finalizing_object_key
        reservation.final_object_key = finalizing_object_key
        reservation.orphan_final_object_keys = _dump_orphan_final_entries(takeover_orphan_entries)
        reservation.final_cleanup_completed_at = None
        reservation.updated_at = now
        reservation_snapshot = {
            "take_uuid": reservation.take_uuid,
            "user_id": reservation.user_id,
            "practice_source_id": reservation.practice_source_id,
            "linked_score_id": reservation.linked_score_id,
            "score_title": reservation.score_title,
            "media_kind": reservation.media_kind,
            "media_mime_type": reservation.media_mime_type,
            "media_byte_size": reservation.media_byte_size,
            "storage_backend": reservation.storage_backend,
            "staging_object_key": reservation.staging_object_key,
            "final_object_key": reservation.final_object_key,
            "finalizing_object_key": reservation.finalizing_object_key,
            "duration_ms": reservation.duration_ms,
            "scope_type": reservation.scope_type,
            "scope_start_beat": reservation.scope_start_beat,
            "scope_terminal_beat": reservation.scope_terminal_beat,
            "scope_start_group_id": reservation.scope_start_group_id,
            "scope_end_group_id": reservation.scope_end_group_id,
            "tempo_plan": reservation.tempo_plan,
            "recording_timebase": reservation.recording_timebase,
            "storage_reservation_id": reservation.storage_reservation_id,
            "expires_at": reservation.expires_at,
            "staging_cleanup_after": reservation.staging_cleanup_after,
            "last_put_url_expires_at": reservation.last_put_url_expires_at,
            "finalizing_token": finalizing_token,
        }
        await db.commit()
        log_stage("lease_acquired", started_at=finalize_started)

        staging_exists = await asyncio.to_thread(
            self.storage.exists, reservation_snapshot["staging_object_key"]
        )
        if reservation_snapshot["expires_at"] < now:
            reservation = await self.repository.get_reservation_by_take_uuid(
                db, user_id, take_uuid, lock=True
            )
            if (
                reservation is not None
                and _status_value(reservation.status)
                == PerformanceTakeUploadReservationStatus.FINALIZING.value
                and reservation.finalizing_token == finalizing_token
            ):
                practice_source_id = reservation.practice_source_id
                reservation.status = PerformanceTakeUploadReservationStatus.EXPIRED.value
                reservation.practice_source_id = None
                reservation.finalizing_token = None
                reservation.finalizing_expires_at = None
                if reservation.finalizing_object_key:
                    reservation.orphan_final_object_keys = _append_orphan_final_key(
                        reservation.orphan_final_object_keys,
                        reservation.finalizing_object_key,
                        unknown_outcome=False,
                    )
                    reservation.finalizing_object_key = None
                reservation.staging_cleanup_after = _max_datetime(
                    reservation.staging_cleanup_after,
                    reservation.last_put_url_expires_at,
                    utc_now_naive(),
                )
                reservation.updated_at = utc_now_naive()
                await self.storage_usage_service.release_reservation(
                    db,
                    reservation.storage_reservation_id,
                    auto_commit=False,
                )
                await self.practice_source_service.release_source_reference(db, practice_source_id)
            await db.commit()
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="reservation_expired")

        source_key = reservation_snapshot["staging_object_key"]
        if not staging_exists:
            reservation = await self.repository.get_reservation_by_take_uuid(
                db, user_id, take_uuid, lock=True
            )
            if (
                reservation is not None
                and _status_value(reservation.status)
                == PerformanceTakeUploadReservationStatus.FINALIZING.value
                and reservation.finalizing_token == finalizing_token
            ):
                reservation.status = PerformanceTakeUploadReservationStatus.RESERVED.value
                reservation.finalizing_token = None
                reservation.finalizing_expires_at = None
                if reservation.finalizing_object_key:
                    reservation.orphan_final_object_keys = _append_orphan_final_key(
                        reservation.orphan_final_object_keys,
                        reservation.finalizing_object_key,
                        unknown_outcome=False,
                    )
                    reservation.finalizing_object_key = None
                reservation.updated_at = utc_now_naive()
                await db.commit()
            raise ResourceNotFoundException(
                "performance_take_media_object",
                reservation_snapshot["take_uuid"],
                ErrorCode.FILE_NOT_FOUND,
            )

        metadata = await asyncio.to_thread(self.storage.object_metadata, source_key)
        if metadata.size_bytes != reservation_snapshot["media_byte_size"]:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")
        if (
            metadata.content_type is not None
            and metadata.content_type.split(";")[0].strip().lower()
            != reservation_snapshot["media_mime_type"]
        ):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")

        header_storage = self.storage
        header_bytes = await asyncio.to_thread(
            lambda: b"".join(header_storage.iter_bytes(source_key, chunk_size=64, start=0, end=63))
        )
        if not _verify_container_magic_bytes(
            header_bytes,
            reservation_snapshot["media_mime_type"],
            reservation_snapshot["media_kind"],
        ):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")
        verified_staging_sha256 = await asyncio.to_thread(
            _sha256_storage_object,
            self.storage,
            reservation_snapshot["staging_object_key"],
        )
        log_stage("staging_verified", started_at=finalize_started)
        log_stage("staging_hash_complete", started_at=finalize_started)

        candidate_key = reservation_snapshot["finalizing_object_key"]
        try:
            await self._ensure_finalize_copy_lease(
                db,
                user_id=user_id,
                take_uuid=take_uuid,
                finalizing_token=finalizing_token,
            )
            await asyncio.to_thread(
                self.storage.copy,
                reservation_snapshot["staging_object_key"],
                candidate_key,
            )
            candidate_metadata = await asyncio.to_thread(
                self.storage.object_metadata, candidate_key
            )
            if candidate_metadata.size_bytes != reservation_snapshot["media_byte_size"]:
                raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")
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

        # The reservation retains the durable source. Live score access controls only
        # the optional navigation link, not admission of this reserved save.
        async def load_source_reference_and_live_score() -> tuple[
            PracticeSourceRef | None,
            Score | None,
        ]:
            source_ref = await self.practice_source_service.find_source(
                db, reservation_snapshot["practice_source_id"]
            )
            linked_score = (
                await db.get(Score, reservation_snapshot["linked_score_id"])
                if reservation_snapshot["linked_score_id"]
                else None
            )
            return source_ref, linked_score

        try:
            source_ref, score = await load_source_reference_and_live_score()
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
            source_ref, score = await load_source_reference_and_live_score()
        log_stage("db_finalize_started", started_at=finalize_started)
        if source_ref is None:
            await self._record_failed_candidate_final(
                db,
                user_id=user_id,
                take_uuid=take_uuid,
                candidate_key=candidate_key,
            )
            await self._delete_candidate_final_async(candidate_key)
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="practice_source_id")

        can_open_score = await self._can_open_score(db, user_id, score)
        score_db_id: int | None = score.id if score is not None else None
        score_title_out = reservation_snapshot["score_title"]

        reservation = await self.repository.get_reservation_by_take_uuid(
            db, user_id, take_uuid, lock=True
        )
        if reservation is None:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="reservation_id")
        existing_take = await self.repository.get_by_reservation(db, user_id, reservation.id)
        if existing_take is not None:
            response = await self._completed_reservation_response(db, reservation, existing_take)
            await db.commit()
            assert response.take is not None
            return response.take
        if (
            _status_value(reservation.status)
            != PerformanceTakeUploadReservationStatus.FINALIZING.value
            or reservation.finalizing_token != finalizing_token
            or reservation.finalizing_object_key != candidate_key
            or reservation.finalizing_expires_at is None
            or reservation.finalizing_expires_at <= utc_now_naive()
        ):
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
            practice_source_id = reservation.practice_source_id
            reservation.orphan_final_object_keys = _append_orphan_final_key(
                reservation.orphan_final_object_keys,
                candidate_key,
                unknown_outcome=False,
            )
            reservation.status = PerformanceTakeUploadReservationStatus.EXPIRED.value
            reservation.practice_source_id = None
            reservation.finalizing_token = None
            reservation.finalizing_expires_at = None
            reservation.finalizing_object_key = None
            reservation.staging_cleanup_after = _max_datetime(
                reservation.staging_cleanup_after,
                reservation.last_put_url_expires_at,
                utc_now_naive(),
            )
            reservation.updated_at = utc_now_naive()
            await self.storage_usage_service.release_reservation(
                db,
                reservation.storage_reservation_id,
                auto_commit=False,
            )
            await self.practice_source_service.release_source_reference(db, practice_source_id)
            await db.commit()
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="reservation_expired")

        # Commit Take, reservation status, and Storage quota in ONE database transaction
        take = PerformanceTake(
            take_uuid=reservation_snapshot["take_uuid"],
            user_id=reservation.user_id,
            practice_source_id=source_ref.id,
            linked_score_id=score_db_id,
            score_title_snapshot=score_title_out,
            upload_reservation_id=reservation.id,
            media_kind=PerformanceTakeMediaKind(reservation_snapshot["media_kind"]),
            media_mime_type=reservation_snapshot["media_mime_type"],
            media_byte_size=reservation_snapshot["media_byte_size"],
            media_object_key=candidate_key,
            storage_backend=reservation_snapshot["storage_backend"],
            duration_ms=reservation_snapshot["duration_ms"],
            scope_type=reservation_snapshot["scope_type"],
            scope_start_beat=reservation_snapshot["scope_start_beat"],
            scope_terminal_beat=reservation_snapshot["scope_terminal_beat"],
            scope_start_group_id=reservation_snapshot["scope_start_group_id"],
            scope_end_group_id=reservation_snapshot["scope_end_group_id"],
            deletion_status=PerformanceTakeDeletionStatus.ACTIVE.value,
            tempo_plan=reservation_snapshot["tempo_plan"],
            recording_timebase=reservation_snapshot["recording_timebase"],
        )
        created = await self.repository.create_take(db, take, auto_commit=False)
        reservation.status = PerformanceTakeUploadReservationStatus.COMPLETED.value
        reservation.practice_source_id = None
        reservation.finalizing_token = None
        reservation.finalizing_expires_at = None
        reservation.finalizing_object_key = None
        reservation.final_object_key = candidate_key
        reservation.staging_cleanup_after = _max_datetime(
            reservation.staging_cleanup_after,
            reservation.last_put_url_expires_at,
            utc_now_naive(),
        )
        reservation.updated_at = utc_now_naive()

        await self.storage_usage_service.commit_reservation(
            db,
            reservation_id=reservation.storage_reservation_id,
            object_type="performance_take",
            object_id=reservation_snapshot["take_uuid"],
            storage_key=candidate_key,
            auto_commit=False,
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

        return self._to_read_dto(
            created,
            source_ref=source_ref,
            score=score,
            can_open_score=can_open_score,
        )

    async def list_takes(
        self,
        db: AsyncSession,
        user_id: int,
        score_id: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> PerformanceTakeListResponse:
        score_db_id: Optional[int] = None
        if score_id is not None:
            score_res = await db.execute(select(Score).where(Score.score_uuid == score_id))
            score_filter = score_res.scalars().first()
            if not score_filter:
                return PerformanceTakeListResponse(
                    items=[], total=0, limit=limit, offset=offset, has_more=False
                )
            score_db_id = score_filter.id

        items, total = await self.repository.list_takes(
            db, user_id, linked_score_id=score_db_id, limit=limit, offset=offset
        )

        score_ids = {item.linked_score_id for item in items if item.linked_score_id is not None}
        score_map: dict[int, Score] = {}
        if score_ids:
            scores_res = await db.execute(select(Score).where(Score.id.in_(score_ids)))
            for s in scores_res.scalars().all():
                if s.id is not None:
                    score_map[s.id] = s

        source_ids = {item.practice_source_id for item in items}
        source_map = await self.practice_source_service.list_sources(db, source_ids)

        read_items: list[PerformanceTakeRead] = []
        for item in items:
            score_obj = (
                score_map.get(item.linked_score_id) if item.linked_score_id is not None else None
            )
            source_ref = source_map.get(item.practice_source_id)
            if source_ref is None:
                continue
            can_open_score = await self._can_open_score(db, user_id, score_obj)
            read_items.append(
                self._to_read_dto(
                    item,
                    source_ref=source_ref,
                    score=score_obj,
                    can_open_score=can_open_score,
                )
            )

        has_more = (offset + len(items)) < total
        return PerformanceTakeListResponse(
            items=read_items,
            total=total,
            limit=limit,
            offset=offset,
            has_more=has_more,
        )

    async def get_take(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> PerformanceTakeRead:
        take = await self.repository.get_by_uuid(db, user_id, take_id)
        if take is None:
            raise ResourceNotFoundException(
                "performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND
            )

        source_ref = await self.practice_source_service.require_source(db, take.practice_source_id)
        score = (
            await db.get(Score, take.linked_score_id) if take.linked_score_id is not None else None
        )
        can_open_score = await self._can_open_score(db, user_id, score)

        return self._to_read_dto(
            take, source_ref=source_ref, score=score, can_open_score=can_open_score
        )

    async def get_playback_url(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> PerformanceTakePlaybackRead:
        take = await self.repository.get_by_uuid(db, user_id, take_id)
        if (
            take is None
            or _status_value(take.deletion_status) == PerformanceTakeDeletionStatus.DELETING.value
        ):
            raise ResourceNotFoundException(
                "performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND
            )

        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")

        playback_url = self.storage.download_url(
            take.media_object_key,
            content_type=take.media_mime_type,
        )
        ext = _extension_for_mime(take.media_mime_type)
        download_url = self.storage.download_url(
            take.media_object_key,
            filename=f"performance-{take.take_uuid}.{ext}",
            content_type=take.media_mime_type,
        )
        if not playback_url or not download_url:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="download_url")

        return PerformanceTakePlaybackRead(
            take_id=take.take_uuid,
            playback_url=playback_url,
            download_url=download_url,
            media_kind=_media_kind_value(take.media_kind),
            media_mime_type=take.media_mime_type,
            media_byte_size=take.media_byte_size,
            duration_ms=take.duration_ms,
            expires_in=3600,
        )

    async def get_media_delivery(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> tuple[str, str, str]:
        """Return an authorized, server-streamed media target without exposing its object key."""
        take = await self.repository.get_by_uuid(db, user_id, take_id)
        if (
            take is None
            or _status_value(take.deletion_status) == PerformanceTakeDeletionStatus.DELETING.value
        ):
            raise ResourceNotFoundException(
                "performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND
            )
        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")
        extension = _extension_for_mime(take.media_mime_type)
        return (
            take.media_object_key,
            f"performance-{take.take_uuid}.{extension}",
            take.media_mime_type,
        )

    async def get_practice_source(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
        *,
        include_notation: bool = False,
    ) -> PracticeSourceRead:
        take = await self.repository.get_by_uuid(db, user_id, take_id)
        if (
            take is None
            or _status_value(take.deletion_status) == PerformanceTakeDeletionStatus.DELETING.value
        ):
            raise ResourceNotFoundException(
                "performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND
            )
        return await self.practice_source_service.read_source_by_id(
            db, take.practice_source_id, include_notation=include_notation
        )

    async def delete_take(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> dict[str, str]:
        take = await self.repository.get_by_uuid(db, user_id, take_id, lock=True)
        if take is None:
            raise ResourceNotFoundException(
                "performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND
            )

        if _status_value(take.deletion_status) == PerformanceTakeDeletionStatus.DELETING.value:
            return {"status": "deleting", "take_id": take_id}

        take.deletion_status = PerformanceTakeDeletionStatus.DELETING.value
        outbox = PerformanceTakeDeleteOutbox(
            take_id=take.id,
            take_uuid=take.take_uuid,
            user_id=take.user_id,
            storage_backend=take.storage_backend,
            object_key=take.media_object_key,
            media_byte_size=take.media_byte_size,
            status=PerformanceTakeDeleteOutboxStatus.PENDING.value,
            next_attempt_at=utc_now_naive(),
        )
        await self.repository.create_delete_outbox(db, outbox, auto_commit=False)
        await db.commit()

        try:
            from app.worker.dispatch.performance_take_deletion import (
                dispatch_performance_take_deletion,
            )

            dispatch_performance_take_deletion(outbox.outbox_uuid)
        except Exception:
            pass

        return {"status": "deleting", "take_id": take_id}
