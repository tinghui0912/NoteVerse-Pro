from __future__ import annotations

from datetime import timedelta
import json
from typing import Optional
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.models.performance_take import (
    PerformanceTake,
    PerformanceTakeDeletionStatus,
    PerformanceTakeMediaKind,
)
from app.db.models.performance_take_delete_outbox import (
    PerformanceTakeDeleteOutbox,
    PerformanceTakeDeleteOutboxStatus,
)
from app.db.models.performance_take_upload_authorization import (
    PerformanceTakeUploadAuthorization,
    PerformanceTakeUploadAuthorizationStatus,
)
from app.db.models.score import Score, ScoreDeletionStatus, ScoreRevision
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
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.storage_usage.service import StorageUsageService
from app.shared.constants import ErrorCode
from app.storage.base import FileStorage
from app.utils.timezone import utc_now_naive

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


def _build_staging_object_key(user_id: int, take_uuid: str, mime_type: str) -> str:
    ext = _extension_for_mime(mime_type)
    return f"staging/performance-takes/{user_id}/{take_uuid}/recording.{ext}"


def _build_final_object_key(user_id: int, take_uuid: str, mime_type: str) -> str:
    ext = _extension_for_mime(mime_type)
    return f"performance-takes/{user_id}/{take_uuid}/recording.{ext}"


def _verify_audio_container_magic_bytes(header_bytes: bytes, mime_type: str) -> bool:
    cleaned = mime_type.split(";")[0].strip().lower()
    if len(header_bytes) < 4:
        return False
    if cleaned == "audio/webm":
        return header_bytes.startswith(b"\x1a\x45\xdf\xa3")
    if cleaned == "audio/ogg":
        return header_bytes.startswith(b"OggS")
    if cleaned in ("audio/wav", "audio/x-wav"):
        if len(header_bytes) < 12:
            return False
        return header_bytes.startswith(b"RIFF") and header_bytes[8:12] == b"WAVE"
    if cleaned in ("audio/mp4", "audio/m4a", "audio/aac"):
        if len(header_bytes) >= 8 and header_bytes[4:8] == b"ftyp":
            return True
        if header_bytes[:2] in (b"\xff\xf1", b"\xff\xf9", b"\xff\xf0"):
            return True
        return False
    if cleaned in ("audio/mpeg", "audio/mp3"):
        if header_bytes.startswith(b"ID3"):
            return True
        if len(header_bytes) >= 2 and header_bytes[0] == 0xFF and (header_bytes[1] & 0xE0) == 0xE0:
            return True
        return False
    return False


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

    def _to_read_dto(
        self,
        take: PerformanceTake,
        *,
        score: Optional[Score] = None,
        revision: Optional[ScoreRevision] = None,
        has_score_view_access: bool = False,
    ) -> PerformanceTakeRead:
        tempo_selection = json.loads(take.tempo_selection) if take.tempo_selection else None
        resolved_tempo_plan = json.loads(take.resolved_tempo_plan) if take.resolved_tempo_plan else None
        sync_metadata = json.loads(take.sync_metadata) if take.sync_metadata else None

        score_id_out: Optional[str] = None
        score_title_out: Optional[str] = take.score_title

        if score is not None:
            if not score_title_out:
                score_title_out = score.title
            if score.deletion_status == ScoreDeletionStatus.ACTIVE and has_score_view_access:
                score_id_out = score.score_uuid

        revision_id_out: Optional[str] = None
        if revision is not None and score_id_out is not None:
            revision_id_out = revision.revision_uuid

        scope_type = getattr(take, "scope_type", "FULL") or "FULL"
        deletion_status = (
            take.deletion_status.value
            if hasattr(take.deletion_status, "value")
            else str(take.deletion_status)
        )

        return PerformanceTakeRead(
            take_id=take.take_uuid,
            score_id=score_id_out,
            score_title=score_title_out,
            revision_id=revision_id_out,
            artifact_id=take.artifact_id,
            media_kind=take.media_kind.value,
            media_mime_type=take.media_mime_type,
            media_byte_size=take.media_byte_size,
            duration_ms=take.duration_ms,
            scope_type=scope_type,
            scope_start_beat=take.scope_start_beat,
            scope_terminal_beat=take.scope_terminal_beat,
            deletion_status=deletion_status,
            tempo_selection=tempo_selection,
            resolved_tempo_plan=resolved_tempo_plan,
            sync_metadata=sync_metadata,
            created_at=take.created_at,
        )

    async def _has_view_access(
        self,
        db: AsyncSession,
        score: Score,
        user_id: int,
    ) -> bool:
        if score.deletion_status != ScoreDeletionStatus.ACTIVE:
            return False
        if score.owner_user_id == user_id:
            return True
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

    async def authorize_upload(
        self,
        db: AsyncSession,
        user_id: int,
        request: PerformanceTakeUploadAuthorizationRequest,
    ) -> PerformanceTakeUploadAuthorizationRead:
        cleaned_mime = request.media_mime_type.split(";")[0].strip().lower()
        if cleaned_mime not in SUPPORTED_AUDIO_MIMES:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")

        if request.scope_start_beat < 0.0 or request.scope_terminal_beat <= request.scope_start_beat:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="scope_terminal_beat")
        if request.duration_ms <= 0:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="duration_ms")
        if request.media_byte_size <= 0:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")

        score_stmt = select(Score).where(
            Score.score_uuid == request.score_id,
            Score.deletion_status == ScoreDeletionStatus.ACTIVE,
        )
        score_res = await db.execute(score_stmt)
        score = score_res.scalars().first()
        if not score:
            raise ResourceNotFoundException("score", request.score_id, ErrorCode.SCORE_NOT_FOUND)

        revision_uuid: str | None = None
        revision: ScoreRevision | None = None
        if request.revision_id is not None:
            rev_stmt = select(ScoreRevision).where(
                ScoreRevision.revision_uuid == request.revision_id,
                ScoreRevision.score_id == score.id,
            )
            rev_res = await db.execute(rev_stmt)
            revision = rev_res.scalars().first()
            if not revision:
                raise ValidationException(ErrorCode.VALIDATION_ERROR, field="revision_id")
            revision_uuid = revision.revision_uuid

        await self.score_access_policy.authorize(
            db,
            score.score_uuid,
            ScoreAction.PRACTICE,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )

        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")

        # Idempotency check: if client_request_id already authorized and active, reuse it
        existing_auth = await self.repository.get_authorization_by_client_request_id(
            db, user_id, request.client_request_id, lock=True
        )
        if existing_auth is not None:
            if existing_auth.status in {
                PerformanceTakeUploadAuthorizationStatus.AUTHORIZED,
                PerformanceTakeUploadAuthorizationStatus.FINALIZING,
                PerformanceTakeUploadAuthorizationStatus.ARCHIVED,
            }:
                upload_target = self.storage.upload_url(
                    key=existing_auth.staging_object_key,
                    content_type=existing_auth.media_mime_type,
                    checksum_sha256="",
                )
                if upload_target is None:
                    raise ValidationException(
                        ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="upload_target"
                    )
                return PerformanceTakeUploadAuthorizationRead(
                    take_id=existing_auth.take_uuid,
                    upload_url=upload_target.upload_url,
                    upload_method=upload_target.upload_method,
                    upload_headers=upload_target.upload_headers,
                    object_key=existing_auth.staging_object_key,
                    reservation_id=existing_auth.reservation_id,
                    expires_in=3600,
                )

        take_uuid = str(uuid4())
        staging_object_key = _build_staging_object_key(user_id, take_uuid, cleaned_mime)
        final_object_key = _build_final_object_key(user_id, take_uuid, cleaned_mime)

        reservation_handle = await self.storage_usage_service.reserve(
            db,
            user_id=user_id,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=request.media_byte_size,
            reason="performance_take_upload_reservation",
            object_type="performance_take",
            object_id=take_uuid,
            storage_key=staging_object_key,
        )

        upload_target = self.storage.upload_url(
            key=staging_object_key,
            content_type=cleaned_mime,
            checksum_sha256="",
        )
        if upload_target is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="upload_target")

        now = utc_now_naive()
        expires_at = now + timedelta(seconds=3600)

        if existing_auth is not None:
            existing_auth.take_uuid = take_uuid
            existing_auth.score_id = score.id
            existing_auth.score_uuid = score.score_uuid
            existing_auth.score_title = score.title
            existing_auth.revision_id = revision.id if revision else None
            existing_auth.revision_uuid = revision.revision_uuid if revision else None
            existing_auth.artifact_id = request.artifact_id
            existing_auth.scope_type = request.scope_type
            existing_auth.scope_start_beat = request.scope_start_beat
            existing_auth.scope_terminal_beat = request.scope_terminal_beat
            existing_auth.tempo_selection = (
                json.dumps(request.tempo_selection) if request.tempo_selection else None
            )
            existing_auth.resolved_tempo_plan = (
                json.dumps(request.resolved_tempo_plan) if request.resolved_tempo_plan else None
            )
            existing_auth.sync_metadata = (
                json.dumps(request.sync_metadata) if request.sync_metadata else None
            )
            existing_auth.duration_ms = request.duration_ms
            existing_auth.media_mime_type = cleaned_mime
            existing_auth.media_byte_size = request.media_byte_size
            existing_auth.storage_backend = self.storage.backend_name
            existing_auth.staging_object_key = staging_object_key
            existing_auth.final_object_key = final_object_key
            existing_auth.reservation_id = reservation_handle.reservation_id
            existing_auth.status = PerformanceTakeUploadAuthorizationStatus.AUTHORIZED
            existing_auth.expires_at = expires_at
            existing_auth.updated_at = now
            await db.commit()
        else:
            auth = PerformanceTakeUploadAuthorization(
                user_id=user_id,
                client_request_id=request.client_request_id,
                take_uuid=take_uuid,
                score_id=score.id,
                score_uuid=score.score_uuid,
                score_title=score.title,
                revision_id=revision.id if revision else None,
                revision_uuid=revision.revision_uuid if revision else None,
                artifact_id=request.artifact_id,
                scope_type=request.scope_type,
                scope_start_beat=request.scope_start_beat,
                scope_terminal_beat=request.scope_terminal_beat,
                tempo_selection=(
                    json.dumps(request.tempo_selection) if request.tempo_selection else None
                ),
                resolved_tempo_plan=(
                    json.dumps(request.resolved_tempo_plan) if request.resolved_tempo_plan else None
                ),
                sync_metadata=(
                    json.dumps(request.sync_metadata) if request.sync_metadata else None
                ),
                duration_ms=request.duration_ms,
                media_mime_type=cleaned_mime,
                media_byte_size=request.media_byte_size,
                storage_backend=self.storage.backend_name,
                staging_object_key=staging_object_key,
                final_object_key=final_object_key,
                reservation_id=reservation_handle.reservation_id,
                status=PerformanceTakeUploadAuthorizationStatus.AUTHORIZED,
                expires_at=expires_at,
            )
            await self.repository.create_authorization(db, auth, auto_commit=True)

        return PerformanceTakeUploadAuthorizationRead(
            take_id=take_uuid,
            upload_url=upload_target.upload_url,
            upload_method=upload_target.upload_method,
            upload_headers=upload_target.upload_headers,
            object_key=staging_object_key,
            reservation_id=reservation_handle.reservation_id,
            expires_in=3600,
        )

    async def cancel_upload_authorization(
        self,
        db: AsyncSession,
        user_id: int,
        reservation_id: str,
    ) -> None:
        auth_stmt = (
            select(PerformanceTakeUploadAuthorization)
            .where(
                PerformanceTakeUploadAuthorization.user_id == user_id,
                PerformanceTakeUploadAuthorization.reservation_id == reservation_id,
            )
            .with_for_update()
        )
        auth_res = await db.execute(auth_stmt)
        auth = auth_res.scalars().first()
        if auth is not None and auth.status == PerformanceTakeUploadAuthorizationStatus.AUTHORIZED:
            auth.status = PerformanceTakeUploadAuthorizationStatus.CANCELLED
            auth.updated_at = utc_now_naive()
            if self.storage is not None and self.storage.exists(auth.staging_object_key):
                self.storage.delete(auth.staging_object_key)
            await self.storage_usage_service.release_reservation(
                db, reservation_id, auto_commit=False
            )
            await db.commit()

    async def finalize_take(
        self,
        db: AsyncSession,
        user_id: int,
        request: PerformanceTakeCreateRequest,
    ) -> PerformanceTakeRead:
        existing_take = await self.repository.get_by_client_request_id(
            db, user_id, request.client_request_id
        )
        if existing_take is not None:
            score = await db.get(Score, existing_take.score_id) if existing_take.score_id else None
            revision = (
                await db.get(ScoreRevision, existing_take.revision_id)
                if existing_take.revision_id
                else None
            )
            has_access = await self._has_view_access(db, score, user_id) if score else False
            return self._to_read_dto(
                existing_take, score=score, revision=revision, has_score_view_access=has_access
            )

        auth = await self.repository.get_authorization_by_take_uuid(
            db, user_id, request.take_id, lock=True
        )
        if (
            auth is None
            or auth.reservation_id != request.reservation_id
            or auth.client_request_id != request.client_request_id
        ):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="reservation_id")

        if auth.status == PerformanceTakeUploadAuthorizationStatus.ARCHIVED:
            archived_take = await self.repository.get_by_uuid(db, user_id, auth.take_uuid)
            if archived_take is not None:
                score = (
                    await db.get(Score, archived_take.score_id) if archived_take.score_id else None
                )
                revision = (
                    await db.get(ScoreRevision, archived_take.revision_id)
                    if archived_take.revision_id
                    else None
                )
                has_access = await self._has_view_access(db, score, user_id) if score else False
                return self._to_read_dto(
                    archived_take, score=score, revision=revision, has_score_view_access=has_access
                )

        if auth.status not in {
            PerformanceTakeUploadAuthorizationStatus.AUTHORIZED,
            PerformanceTakeUploadAuthorizationStatus.FINALIZING,
        }:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": auth.status.value},
            )

        now = utc_now_naive()
        if auth.expires_at < now:
            auth.status = PerformanceTakeUploadAuthorizationStatus.EXPIRED
            auth.updated_at = now
            if self.storage is not None and self.storage.exists(auth.staging_object_key):
                self.storage.delete(auth.staging_object_key)
            await self.storage_usage_service.release_reservation(
                db, auth.reservation_id, auto_commit=False
            )
            await db.commit()
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="authorization_expired")

        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")

        if not self.storage.exists(auth.staging_object_key):
            raise ResourceNotFoundException(
                "performance_take_media_object",
                auth.take_uuid,
                ErrorCode.FILE_NOT_FOUND,
            )

        metadata = self.storage.object_metadata(auth.staging_object_key)
        if metadata.size_bytes != auth.media_byte_size:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")

        header_bytes = b"".join(
            self.storage.iter_bytes(auth.staging_object_key, chunk_size=64, start=0, end=63)
        )
        if not _verify_audio_container_magic_bytes(header_bytes, auth.media_mime_type):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")

        # Promote staging object to final immutable object key
        self.storage.copy(auth.staging_object_key, auth.final_object_key)

        # Resolve score/revision at finalize time; if score deleted, keep score_title snapshot
        score = await db.get(Score, auth.score_id) if auth.score_id else None
        score_db_id: int | None = None
        score_title_out = auth.score_title
        revision_db_id: int | None = None
        revision_obj: ScoreRevision | None = None
        if score is not None and score.deletion_status == ScoreDeletionStatus.ACTIVE:
            score_db_id = score.id
            score_title_out = score.title
            if auth.revision_id:
                rev = await db.get(ScoreRevision, auth.revision_id)
                if rev is not None and rev.score_id == score.id:
                    revision_db_id = rev.id
                    revision_obj = rev

        # Commit Take, Auth status, and Storage quota in ONE database transaction
        take = PerformanceTake(
            take_uuid=auth.take_uuid,
            user_id=auth.user_id,
            score_id=score_db_id,
            score_title=score_title_out,
            revision_id=revision_db_id,
            artifact_id=auth.artifact_id,
            client_request_id=auth.client_request_id,
            media_kind=PerformanceTakeMediaKind.AUDIO,
            media_mime_type=auth.media_mime_type,
            media_byte_size=auth.media_byte_size,
            media_object_key=auth.final_object_key,
            storage_backend=auth.storage_backend,
            duration_ms=auth.duration_ms,
            scope_type=auth.scope_type,
            scope_start_beat=auth.scope_start_beat,
            scope_terminal_beat=auth.scope_terminal_beat,
            deletion_status=PerformanceTakeDeletionStatus.ACTIVE,
            tempo_selection=auth.tempo_selection,
            resolved_tempo_plan=auth.resolved_tempo_plan,
            sync_metadata=auth.sync_metadata,
        )
        created = await self.repository.create_take(db, take, auto_commit=False)
        auth.status = PerformanceTakeUploadAuthorizationStatus.ARCHIVED
        auth.updated_at = utc_now_naive()

        await self.storage_usage_service.commit_reservation(
            db,
            reservation_id=auth.reservation_id,
            object_type="performance_take",
            object_id=auth.take_uuid,
            storage_key=auth.final_object_key,
            auto_commit=False,
        )
        await db.commit()

        # Clean staging object now that final object and DB record are committed
        try:
            self.storage.delete(auth.staging_object_key)
        except Exception:
            pass

        has_access = await self._has_view_access(db, score, user_id) if score else False
        return self._to_read_dto(
            created, score=score, revision=revision_obj, has_score_view_access=has_access
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
            db, user_id, score_id=score_db_id, limit=limit, offset=offset
        )

        score_ids = {item.score_id for item in items if item.score_id is not None}
        score_map: dict[int, Score] = {}
        score_access_map: dict[int, bool] = {}
        if score_ids:
            scores_res = await db.execute(select(Score).where(Score.id.in_(score_ids)))
            for s in scores_res.scalars().all():
                if s.id is not None:
                    score_map[s.id] = s
                    if s.owner_user_id == user_id:
                        score_access_map[s.id] = True
                    else:
                        score_access_map[s.id] = await self._has_view_access(db, s, user_id)

        revision_ids = {item.revision_id for item in items if item.revision_id is not None}
        revision_map: dict[int, ScoreRevision] = {}
        if revision_ids:
            revs_res = await db.execute(select(ScoreRevision).where(ScoreRevision.id.in_(revision_ids)))
            for r in revs_res.scalars().all():
                if r.id is not None:
                    revision_map[r.id] = r

        read_items: list[PerformanceTakeRead] = []
        for item in items:
            score_obj = score_map.get(item.score_id) if item.score_id else None
            rev_obj = revision_map.get(item.revision_id) if item.revision_id else None
            has_acc = score_access_map.get(item.score_id, False) if item.score_id else False
            read_items.append(
                self._to_read_dto(
                    item,
                    score=score_obj,
                    revision=rev_obj,
                    has_score_view_access=has_acc,
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
            raise ResourceNotFoundException("performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND)

        score = await db.get(Score, take.score_id) if take.score_id else None
        revision = await db.get(ScoreRevision, take.revision_id) if take.revision_id else None
        has_access = await self._has_view_access(db, score, user_id) if score else False

        return self._to_read_dto(take, score=score, revision=revision, has_score_view_access=has_access)

    async def get_playback_url(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> PerformanceTakePlaybackRead:
        take = await self.repository.get_by_uuid(db, user_id, take_id)
        if take is None or take.deletion_status == PerformanceTakeDeletionStatus.DELETING:
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
    ) -> dict[str, str]:
        take = await self.repository.get_by_uuid(db, user_id, take_id, lock=True)
        if take is None:
            raise ResourceNotFoundException("performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND)

        if take.deletion_status == PerformanceTakeDeletionStatus.DELETING:
            return {"status": "deleting", "take_id": take_id}

        take.deletion_status = PerformanceTakeDeletionStatus.DELETING
        outbox = PerformanceTakeDeleteOutbox(
            take_id=take.id,
            take_uuid=take.take_uuid,
            user_id=take.user_id,
            storage_backend=take.storage_backend,
            object_key=take.media_object_key,
            media_byte_size=take.media_byte_size,
            status=PerformanceTakeDeleteOutboxStatus.PENDING,
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
