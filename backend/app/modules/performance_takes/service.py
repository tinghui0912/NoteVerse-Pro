from __future__ import annotations

import json
from typing import Optional
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.models.performance_take import PerformanceTake, PerformanceTakeMediaKind
from app.db.models.score import Score, ScoreDeletionStatus, ScoreRevision
from app.db.models.storage_usage import StorageUsageCategory, StorageUsageReservationStatus
from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.performance_takes.schemas import (
    PerformanceTakeCreateRequest,
    PerformanceTakeListResponse,
    PerformanceTakePlaybackRead,
    PerformanceTakeRead,
    PerformanceTakeUploadAuthorizationRead,
    PerformanceTakeUploadAuthorizationRequest,
)
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.storage_usage.service import StorageUsageService
from app.shared.constants import ErrorCode
from app.storage.base import DirectUploadTarget, FileStorage

SUPPORTED_AUDIO_MIMES = {
    "audio/webm",
    "audio/mp4",
    "audio/m4a",
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
    "audio/mpeg",
    "audio/mp3",
    "audio/aac",
}


def _extension_for_mime(mime_type: str) -> str:
    cleaned = mime_type.split(";")[0].strip().lower()
    mapping = {
        "audio/webm": "webm",
        "audio/mp4": "mp4",
        "audio/m4a": "m4a",
        "audio/ogg": "ogg",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
        "audio/mpeg": "mp3",
        "audio/mp3": "mp3",
        "audio/aac": "aac",
    }
    return mapping.get(cleaned, "webm")


class PerformanceTakeService:
    def __init__(
        self,
        repository: PerformanceTakeRepository | None = None,
        storage: FileStorage | None = None,
        storage_usage_service: StorageUsageService | None = None,
        score_access_policy: ScoreAccessPolicy | None = None,
    ) -> None:
        self.repository = repository or PerformanceTakeRepository()
        self.storage = storage  # type: ignore[assignment]
        self.storage_usage_service = storage_usage_service or StorageUsageService()
        self.score_access_policy = score_access_policy or ScoreAccessPolicy()

    def _build_object_key(self, user_id: int, take_uuid: str, mime_type: str) -> str:
        ext = _extension_for_mime(mime_type)
        return f"performance-takes/{user_id}/{take_uuid}/recording.{ext}"

    def _to_read_dto(self, take: PerformanceTake) -> PerformanceTakeRead:
        tempo_selection = json.loads(take.tempo_selection) if take.tempo_selection else None
        resolved_tempo_plan = json.loads(take.resolved_tempo_plan) if take.resolved_tempo_plan else None
        sync_metadata = json.loads(take.sync_metadata) if take.sync_metadata else None
        return PerformanceTakeRead(
            take_id=take.take_uuid,
            score_id=take.score_id,
            score_title=take.score_title,
            revision_id=take.revision_id,
            artifact_id=take.artifact_id,
            media_kind=take.media_kind.value,
            media_mime_type=take.media_mime_type,
            media_byte_size=take.media_byte_size,
            duration_ms=take.duration_ms,
            scope_start_beat=take.scope_start_beat,
            scope_terminal_beat=take.scope_terminal_beat,
            tempo_selection=tempo_selection,
            resolved_tempo_plan=resolved_tempo_plan,
            sync_metadata=sync_metadata,
            created_at=take.created_at,
        )

    async def authorize_upload(
        self,
        db: AsyncSession,
        user_id: int,
        request: PerformanceTakeUploadAuthorizationRequest,
    ) -> PerformanceTakeUploadAuthorizationRead:
        # 1. Whitelist audio MIME type
        cleaned_mime = request.media_mime_type.split(";")[0].strip().lower()
        if cleaned_mime not in SUPPORTED_AUDIO_MIMES:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")

        # 2. Validate beat scope and duration
        if request.scope_start_beat < 0.0 or request.scope_terminal_beat <= request.scope_start_beat:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="scope_terminal_beat")
        if request.duration_ms <= 0:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="duration_ms")
        if request.media_byte_size <= 0:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")

        # 3. Validate score exists, is active
        score = await db.get(Score, request.score_id)
        if not score or score.deletion_status != ScoreDeletionStatus.ACTIVE:
            raise ResourceNotFoundException("score", str(request.score_id), ErrorCode.SCORE_NOT_FOUND)

        # 4. If revision_id is specified, verify it belongs to this score
        revision_uuid: str | None = None
        if request.revision_id is not None:
            revision = await db.get(ScoreRevision, request.revision_id)
            if not revision or revision.score_id != score.id:
                raise ValidationException(ErrorCode.VALIDATION_ERROR, field="revision_id")
            revision_uuid = revision.revision_uuid

        await self.score_access_policy.authorize(
            db,
            score.score_uuid,
            ScoreAction.PRACTICE,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )

        take_uuid = str(uuid4())
        object_key = self._build_object_key(user_id, take_uuid, cleaned_mime)

        # 5. Reserve storage quota
        reservation_handle = await self.storage_usage_service.reserve(
            db,
            user_id=user_id,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=request.media_byte_size,
            reason="performance_take_upload_reservation",
            object_type="performance_take",
            object_id=take_uuid,
            storage_key=object_key,
        )

        # 6. Generate presigned direct upload URL (OSS direct upload)
        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")
        upload_target = self.storage.upload_url(
            key=object_key,
            content_type=cleaned_mime,
            checksum_sha256="",
        )
        if upload_target is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="upload_target")

        return PerformanceTakeUploadAuthorizationRead(
            take_id=take_uuid,
            upload_url=upload_target.upload_url,
            upload_method=upload_target.upload_method,
            upload_headers=upload_target.upload_headers,
            object_key=object_key,
            reservation_id=reservation_handle.reservation_id,
            expires_in=3600,
        )

    async def cancel_upload_authorization(
        self,
        db: AsyncSession,
        user_id: int,
        reservation_id: str,
    ) -> None:
        reservation = await self.storage_usage_service.repository.reservation(db, reservation_id, lock=True)
        if reservation and reservation.user_id == user_id and reservation.status == StorageUsageReservationStatus.RESERVED:
            await self.storage_usage_service.release_reservation(db, reservation_id)

    async def finalize_take(
        self,
        db: AsyncSession,
        user_id: int,
        request: PerformanceTakeCreateRequest,
    ) -> PerformanceTakeRead:
        # 1. Idempotency check: return existing take if same client_request_id already saved
        existing = await self.repository.get_by_client_request_id(
            db, user_id, request.client_request_id
        )
        if existing is not None:
            return self._to_read_dto(existing)

        cleaned_mime = request.media_mime_type.split(";")[0].strip().lower()
        if cleaned_mime not in SUPPORTED_AUDIO_MIMES:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")

        object_key = self._build_object_key(user_id, request.take_id, cleaned_mime)

        # 2. Strict Server Reservation Binding Validation
        reservation = await self.storage_usage_service.repository.reservation(
            db, request.reservation_id, lock=True
        )
        if reservation is None or reservation.user_id != user_id:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="reservation_id")
        if reservation.status != StorageUsageReservationStatus.RESERVED:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="reservation_id")
        if reservation.object_type != "performance_take" or reservation.object_id != request.take_id:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="reservation_id")
        if reservation.storage_key != object_key:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="reservation_id")
        if reservation.bytes_reserved != request.media_byte_size:
            await self.storage_usage_service.release_reservation(db, request.reservation_id)
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")

        # 3. Verify media object exists in storage and matches byte size
        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")

        if not self.storage.exists(object_key):
            # Auto-release reservation on missing media object
            await self.storage_usage_service.release_reservation(db, request.reservation_id)
            raise ResourceNotFoundException(
                "performance_take_media_object",
                request.take_id,
                ErrorCode.FILE_NOT_FOUND,
            )

        metadata = self.storage.object_metadata(object_key)
        if metadata.size_bytes != request.media_byte_size:
            await self.storage_usage_service.release_reservation(db, request.reservation_id)
            raise ValidationException(code=ErrorCode.VALIDATION_ERROR, field="media_byte_size")

        # 4. Snapshot score title if score exists
        score = await db.get(Score, request.score_id)
        score_title = score.title if score else None

        # 5. Commit quota reservation
        await self.storage_usage_service.commit_reservation(
            db,
            reservation_id=request.reservation_id,
            object_type="performance_take",
            object_id=request.take_id,
            storage_key=object_key,
        )

        # 6. Persist PerformanceTake entity
        take = PerformanceTake(
            take_uuid=request.take_id,
            user_id=user_id,
            score_id=request.score_id,
            score_title=score_title,
            revision_id=request.revision_id,
            artifact_id=request.artifact_id,
            client_request_id=request.client_request_id,
            media_kind=PerformanceTakeMediaKind.AUDIO,
            media_mime_type=cleaned_mime,
            media_byte_size=request.media_byte_size,
            media_object_key=object_key,
            storage_backend=self.storage.backend_name,
            duration_ms=request.duration_ms,
            scope_start_beat=request.scope_start_beat,
            scope_terminal_beat=request.scope_terminal_beat,
            tempo_selection=json.dumps(request.tempo_selection) if request.tempo_selection else None,
            resolved_tempo_plan=json.dumps(request.resolved_tempo_plan) if request.resolved_tempo_plan else None,
            sync_metadata=json.dumps(request.sync_metadata) if request.sync_metadata else None,
        )
        created = await self.repository.create_take(db, take)
        return self._to_read_dto(created)

    async def list_takes(
        self,
        db: AsyncSession,
        user_id: int,
        score_id: Optional[int] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> PerformanceTakeListResponse:
        items, total = await self.repository.list_takes(
            db, user_id, score_id=score_id, limit=limit, offset=offset
        )
        has_more = (offset + len(items)) < total
        return PerformanceTakeListResponse(
            items=[self._to_read_dto(item) for item in items],
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
            raise ResourceNotFoundException("performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND)
        return self._to_read_dto(take)

    async def get_playback_url(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> PerformanceTakePlaybackRead:
        take = await self.repository.get_by_uuid(db, user_id, take_id)
        if take is None:
            raise ResourceNotFoundException("performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND)

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
            media_kind=take.media_kind.value,
            media_mime_type=take.media_mime_type,
            media_byte_size=take.media_byte_size,
            duration_ms=take.duration_ms,
            expires_in=3600,
        )

    async def delete_take(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> None:
        take = await self.repository.get_by_uuid(db, user_id, take_id)
        if take is None:
            raise ResourceNotFoundException("performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND)

        # 1. Delete OSS storage object FIRST (idempotent, fails before quota or DB touched)
        if self.storage is not None:
            self.storage.delete(take.media_object_key)

        # 2. In single database transaction: delete DB record and release quota
        await self.repository.delete_take(db, take)
        await self.storage_usage_service.record_release(
            db,
            user_id=take.user_id,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=take.media_byte_size,
            reason="performance_take_deleted",
            object_type="performance_take",
            object_id=take.take_uuid,
            storage_key=take.media_object_key,
        )
        await db.commit()
