from __future__ import annotations

import json
from typing import Optional
from uuid import uuid4

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.models.performance_take import PerformanceTake, PerformanceTakeMediaKind
from app.db.models.storage_usage import StorageUsageCategory
from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.performance_takes.schemas import (
    PerformanceTakeCreateRequest,
    PerformanceTakeListResponse,
    PerformanceTakePlaybackRead,
    PerformanceTakeRead,
    PerformanceTakeUploadAuthorizationRead,
    PerformanceTakeUploadAuthorizationRequest,
)
from app.modules.storage_usage.service import StorageUsageService
from app.shared.constants import ErrorCode
from app.storage.base import DirectUploadTarget, FileStorage


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
    ) -> None:
        self.repository = repository or PerformanceTakeRepository()
        self.storage = storage  # type: ignore[assignment]
        self.storage_usage_service = storage_usage_service or StorageUsageService()

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
        # Validate MIME is audio
        cleaned_mime = request.media_mime_type.split(";")[0].strip().lower()
        if not cleaned_mime.startswith("audio/"):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")

        take_uuid = str(uuid4())
        object_key = self._build_object_key(user_id, take_uuid, cleaned_mime)

        # Reserve storage quota
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

        upload_target: DirectUploadTarget | None = None
        if self.storage is not None:
            upload_target = self.storage.upload_url(
                key=object_key,
                content_type=cleaned_mime,
                checksum_sha256="",
            )

        if upload_target is None:
            upload_target = DirectUploadTarget(
                upload_url=f"/api/v1/performance-takes/local-uploads/{take_uuid}?mime_type={cleaned_mime}",
                upload_method="PUT",
                upload_headers={"content-type": cleaned_mime},
            )

        return PerformanceTakeUploadAuthorizationRead(
            take_id=take_uuid,
            upload_url=upload_target.upload_url,
            upload_method=upload_target.upload_method,
            upload_headers=upload_target.upload_headers,
            object_key=object_key,
            reservation_id=reservation_handle.reservation_id,
            expires_in=3600,
        )

    async def upload_take_object_for_local_storage(
        self,
        user_id: int,
        take_uuid: str,
        *,
        content: bytes,
        mime_type: str,
    ) -> None:
        if self.storage.backend_name != "local":
            raise ValidationException(code=ErrorCode.VALIDATION_ERROR, field="storage_backend")
        object_key = self._build_object_key(user_id, take_uuid, mime_type)
        self.storage.put_bytes(
            key=object_key,
            content=content,
            content_type=mime_type,
        )

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

        # 2. Verify media object exists in storage
        cleaned_mime = request.media_mime_type.split(";")[0].strip().lower()
        object_key = self._build_object_key(user_id, request.take_id, cleaned_mime)
        if not self.storage.exists(object_key):
            raise ResourceNotFoundException(
                "performance_take_media_object",
                request.take_id,
                ErrorCode.FILE_NOT_FOUND,
            )

        # 3. Verify media byte size matches
        metadata = self.storage.object_metadata(object_key)
        if metadata.size_bytes != request.media_byte_size:
            raise ValidationException(code=ErrorCode.VALIDATION_ERROR, field="media_byte_size")

        # 4. Commit quota reservation
        await self.storage_usage_service.commit_reservation(
            db,
            reservation_id=request.reservation_id,
            object_type="performance_take",
            object_id=request.take_id,
            storage_key=object_key,
        )

        # 5. Persist PerformanceTake
        take = PerformanceTake(
            take_uuid=request.take_id,
            user_id=user_id,
            score_id=request.score_id,
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
        return PerformanceTakeListResponse(
            items=[self._to_read_dto(item) for item in items],
            total=total,
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

        playback_url = self.storage.download_url(
            take.media_object_key,
            content_type=take.media_mime_type,
        )
        if not playback_url:
            playback_url = f"/api/v1/performance-takes/{take.take_uuid}/media"

        ext = _extension_for_mime(take.media_mime_type)
        download_url = self.storage.download_url(
            take.media_object_key,
            filename=f"performance-{take.take_uuid}.{ext}",
            content_type=take.media_mime_type,
        )
        if not download_url:
            download_url = f"/api/v1/performance-takes/{take.take_uuid}/media?download=true"

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

        # 1. Release storage quota
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

        # 2. Delete storage object
        self.storage.delete(take.media_object_key)

        # 3. Delete database record
        await self.repository.delete_take(db, take)
