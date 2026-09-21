from __future__ import annotations

from datetime import datetime, timedelta
import json
import logging
from typing import Optional
from uuid import uuid4

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
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
    "audio/ogg",
    "audio/wav",
    "audio/x-wav",
}
MAX_TAKE_MEDIA_BYTES = 100 * 1024 * 1024
MAX_TAKE_DURATION_MS = 12 * 60 * 60 * 1000
MAX_TAKE_METADATA_JSON_BYTES = 64 * 1024
TAKE_UPLOAD_AUTHORIZATION_SECONDS = 3600
TAKE_FINALIZING_LEASE_SECONDS = 15 * 60
logger = logging.getLogger(__name__)


def _extension_for_mime(mime_type: str) -> str:
    cleaned = mime_type.split(";")[0].strip().lower()
    mapping = {
        "audio/webm": "webm",
        "audio/mp4": "mp4",
        "audio/ogg": "ogg",
        "audio/wav": "wav",
        "audio/x-wav": "wav",
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
    if cleaned == "audio/mp4":
        if len(header_bytes) >= 8 and header_bytes[4:8] == b"ftyp":
            return True
        return False
    return False


def _json_snapshot(value: object | None) -> str | None:
    if value is None:
        return None
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > MAX_TAKE_METADATA_JSON_BYTES:
        raise ValidationException(ErrorCode.VALIDATION_ERROR, field="metadata_size")
    return encoded


def _json_equivalent(left: str | None, right: object | None) -> bool:
    if left is None and right is None:
        return True
    try:
        left_value = None if left is None else json.loads(left)
    except json.JSONDecodeError:
        left_value = left
    return left_value == right


def _max_datetime(*values: datetime | None) -> datetime | None:
    present = [value for value in values if value is not None]
    return max(present) if present else None


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

    async def _archived_authorization_response(
        self,
        db: AsyncSession,
        user_id: int,
        take: PerformanceTake,
    ) -> PerformanceTakeUploadAuthorizationRead:
        score = await db.get(Score, take.score_id) if take.score_id else None
        revision = await db.get(ScoreRevision, take.revision_id) if take.revision_id else None
        has_access = await self._has_view_access(db, score, user_id) if score else False
        return PerformanceTakeUploadAuthorizationRead(
            take_id=take.take_uuid,
            status=PerformanceTakeUploadAuthorizationStatus.ARCHIVED.value,
            take=self._to_read_dto(
                take,
                score=score,
                revision=revision,
                has_score_view_access=has_access,
            ),
        )

    def _authorization_matches_request(
        self,
        auth: PerformanceTakeUploadAuthorization,
        request: PerformanceTakeUploadAuthorizationRequest,
        cleaned_mime: str,
    ) -> bool:
        return (
            auth.score_uuid == request.score_id
            and auth.revision_uuid == request.revision_id
            and auth.artifact_id == request.artifact_id
            and auth.scope_type == request.scope_type
            and auth.scope_start_beat == request.scope_start_beat
            and auth.scope_terminal_beat == request.scope_terminal_beat
            and auth.duration_ms == request.duration_ms
            and auth.media_mime_type == cleaned_mime
            and auth.media_byte_size == request.media_byte_size
            and _json_equivalent(auth.tempo_selection, request.tempo_selection)
            and _json_equivalent(auth.resolved_tempo_plan, request.resolved_tempo_plan)
            and _json_equivalent(auth.sync_metadata, request.sync_metadata)
        )

    def _authorization_matches_finalize_request(
        self,
        auth: PerformanceTakeUploadAuthorization,
        request: PerformanceTakeCreateRequest,
    ) -> bool:
        cleaned_mime = request.media_mime_type.split(";")[0].strip().lower()
        return (
            auth.score_uuid == request.score_id
            and auth.revision_uuid == request.revision_id
            and auth.artifact_id == request.artifact_id
            and auth.scope_type == request.scope_type
            and auth.scope_start_beat == request.scope_start_beat
            and auth.scope_terminal_beat == request.scope_terminal_beat
            and auth.duration_ms == request.duration_ms
            and auth.media_mime_type == cleaned_mime
            and auth.media_byte_size == request.media_byte_size
            and _json_equivalent(auth.tempo_selection, request.tempo_selection)
            and _json_equivalent(auth.resolved_tempo_plan, request.resolved_tempo_plan)
            and _json_equivalent(auth.sync_metadata, request.sync_metadata)
        )

    def _take_matches_authorization(
        self,
        take: PerformanceTake,
        auth: PerformanceTakeUploadAuthorization,
    ) -> bool:
        return (
            take.take_uuid == auth.take_uuid
            and take.user_id == auth.user_id
            and take.client_request_id == auth.client_request_id
            and take.media_mime_type == auth.media_mime_type
            and take.media_byte_size == auth.media_byte_size
            and take.media_object_key == auth.final_object_key
            and take.storage_backend == auth.storage_backend
            and take.duration_ms == auth.duration_ms
            and take.scope_type == auth.scope_type
            and take.scope_start_beat == auth.scope_start_beat
            and take.scope_terminal_beat == auth.scope_terminal_beat
            and take.artifact_id == auth.artifact_id
            and take.tempo_selection == auth.tempo_selection
            and take.resolved_tempo_plan == auth.resolved_tempo_plan
            and take.sync_metadata == auth.sync_metadata
        )

    def _put_url_expires_at(self, now: datetime) -> datetime:
        return now + timedelta(seconds=settings.S3_PRESIGN_EXPIRE_SECONDS)

    async def _expire_authorization(
        self,
        db: AsyncSession,
        auth: PerformanceTakeUploadAuthorization,
    ) -> str:
        now = utc_now_naive()
        auth.status = PerformanceTakeUploadAuthorizationStatus.EXPIRED
        auth.staging_cleanup_after = _max_datetime(
            auth.staging_cleanup_after,
            auth.last_put_url_expires_at,
            now,
        )
        auth.updated_at = now
        await self.storage_usage_service.release_reservation(
            db, auth.reservation_id, auto_commit=False
        )
        await db.commit()
        return auth.staging_object_key

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
        if request.duration_ms > MAX_TAKE_DURATION_MS:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="duration_ms")
        if request.media_byte_size <= 0:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")
        if request.media_byte_size > MAX_TAKE_MEDIA_BYTES:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")

        _json_snapshot(request.tempo_selection)
        _json_snapshot(request.resolved_tempo_plan)
        _json_snapshot(request.sync_metadata)

        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")

        existing_take = await self.repository.get_by_client_request_id(
            db, user_id, request.client_request_id
        )
        if existing_take is not None:
            return await self._archived_authorization_response(db, user_id, existing_take)

        existing_auth = await self.repository.get_authorization_by_client_request_id(
            db, user_id, request.client_request_id, lock=True
        )
        if existing_auth is not None:
            if existing_auth.status == PerformanceTakeUploadAuthorizationStatus.ARCHIVED:
                archived_take = await self.repository.get_by_uuid(
                    db, user_id, existing_auth.take_uuid
                )
                if archived_take is not None:
                    return await self._archived_authorization_response(
                        db, user_id, archived_take
                    )
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR,
                    field="client_request_id",
                    details={"reason": "archived_authorization_missing_take"},
                )
            if existing_auth.status == PerformanceTakeUploadAuthorizationStatus.AUTHORIZED:
                if not self._authorization_matches_request(existing_auth, request, cleaned_mime):
                    raise ValidationException(
                        ErrorCode.VALIDATION_ERROR,
                        field="client_request_id",
                        details={"reason": "client_request_id_reuse_conflict"},
                    )
                if existing_auth.expires_at <= utc_now_naive():
                    await self._expire_authorization(db, existing_auth)
                    raise ValidationException(
                        ErrorCode.VALIDATION_ERROR,
                        field="client_request_id",
                        details={"reason": "client_request_id_expired_use_new_id"},
                    )
                upload_target = self.storage.upload_url(
                    key=existing_auth.staging_object_key,
                    content_type=existing_auth.media_mime_type,
                    checksum_sha256="",
                )
                if upload_target is None:
                    raise ValidationException(
                        ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="upload_target"
                    )
                now = utc_now_naive()
                put_url_expires_at = self._put_url_expires_at(now)
                existing_auth.last_put_url_expires_at = put_url_expires_at
                existing_auth.staging_cleanup_after = _max_datetime(
                    existing_auth.staging_cleanup_after,
                    put_url_expires_at,
                )
                existing_auth.updated_at = now
                await db.commit()
                return PerformanceTakeUploadAuthorizationRead(
                    take_id=existing_auth.take_uuid,
                    status=PerformanceTakeUploadAuthorizationStatus.AUTHORIZED.value,
                    upload_url=upload_target.upload_url,
                    upload_method=upload_target.upload_method,
                    upload_headers=upload_target.upload_headers,
                    object_key=existing_auth.staging_object_key,
                    reservation_id=existing_auth.reservation_id,
                    expires_in=settings.S3_PRESIGN_EXPIRE_SECONDS,
                )
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": f"client_request_id_{existing_auth.status.value.lower()}"},
            )

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

        take_uuid = str(uuid4())
        staging_object_key = _build_staging_object_key(user_id, take_uuid, cleaned_mime)
        final_object_key = _build_final_object_key(user_id, take_uuid, cleaned_mime)

        upload_target = self.storage.upload_url(
            key=staging_object_key,
            content_type=cleaned_mime,
            checksum_sha256="",
        )
        if upload_target is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="upload_target")

        reservation_handle = await self.storage_usage_service.reserve(
            db,
            user_id=user_id,
            category=StorageUsageCategory.UPLOAD,
            bytes_count=request.media_byte_size,
            reason="performance_take_upload_reservation",
            object_type="performance_take",
            object_id=take_uuid,
            storage_key=staging_object_key,
            auto_commit=False,
        )

        now = utc_now_naive()
        expires_at = now + timedelta(seconds=TAKE_UPLOAD_AUTHORIZATION_SECONDS)
        put_url_expires_at = self._put_url_expires_at(now)

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
            tempo_selection=_json_snapshot(request.tempo_selection),
            resolved_tempo_plan=_json_snapshot(request.resolved_tempo_plan),
            sync_metadata=_json_snapshot(request.sync_metadata),
            duration_ms=request.duration_ms,
            media_mime_type=cleaned_mime,
            media_byte_size=request.media_byte_size,
            storage_backend=self.storage.backend_name,
            staging_object_key=staging_object_key,
            final_object_key=final_object_key,
            reservation_id=reservation_handle.reservation_id,
            status=PerformanceTakeUploadAuthorizationStatus.AUTHORIZED,
            expires_at=expires_at,
            last_put_url_expires_at=put_url_expires_at,
            staging_cleanup_after=put_url_expires_at,
        )
        await self.repository.create_authorization(db, auth, auto_commit=False)
        await db.commit()

        return PerformanceTakeUploadAuthorizationRead(
            take_id=take_uuid,
            status=PerformanceTakeUploadAuthorizationStatus.AUTHORIZED.value,
            upload_url=upload_target.upload_url,
            upload_method=upload_target.upload_method,
            upload_headers=upload_target.upload_headers,
            object_key=staging_object_key,
            reservation_id=reservation_handle.reservation_id,
            expires_in=settings.S3_PRESIGN_EXPIRE_SECONDS,
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
        staging_key: str | None = None
        if auth is not None and auth.status == PerformanceTakeUploadAuthorizationStatus.AUTHORIZED:
            now = utc_now_naive()
            auth.status = PerformanceTakeUploadAuthorizationStatus.CANCELLED
            auth.staging_cleanup_after = _max_datetime(
                auth.staging_cleanup_after,
                auth.last_put_url_expires_at,
                now,
            )
            auth.updated_at = now
            staging_key = auth.staging_object_key
            await self.storage_usage_service.release_reservation(
                db, reservation_id, auto_commit=False
            )
            await db.commit()
        if (
            staging_key is not None
            and self.storage is not None
            and auth is not None
            and auth.staging_cleanup_after is not None
            and auth.staging_cleanup_after <= utc_now_naive()
        ):
            try:
                if self.storage.exists(staging_key):
                    self.storage.delete(staging_key)
            except Exception:
                logger.exception(
                    "performance_take_upload_authorization.cancel_staging_delete_failed",
                    extra={"reservation_id": reservation_id, "staging_object_key": staging_key},
                )

    async def finalize_take(
        self,
        db: AsyncSession,
        user_id: int,
        request: PerformanceTakeCreateRequest,
    ) -> PerformanceTakeRead:
        auth = await self.repository.get_authorization_by_take_uuid(
            db, user_id, request.take_id, lock=True
        )
        if (
            auth is None
            or auth.reservation_id != request.reservation_id
            or auth.client_request_id != request.client_request_id
        ):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="reservation_id")

        existing_take = await self.repository.get_by_client_request_id(
            db, user_id, request.client_request_id
        )
        if existing_take is not None:
            if not self._authorization_matches_finalize_request(
                auth,
                request,
            ) or not self._take_matches_authorization(existing_take, auth):
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR,
                    field="client_request_id",
                    details={"reason": "client_request_id_reuse_conflict"},
                )
            response = await self._archived_authorization_response(db, user_id, existing_take)
            if response.take is not None:
                await db.commit()
                return response.take

        now = utc_now_naive()
        if auth.status == PerformanceTakeUploadAuthorizationStatus.ARCHIVED:
            archived_take = await self.repository.get_by_uuid(db, user_id, auth.take_uuid)
            if archived_take is not None:
                if not self._authorization_matches_finalize_request(auth, request):
                    raise ValidationException(
                        ErrorCode.VALIDATION_ERROR,
                        field="client_request_id",
                        details={"reason": "client_request_id_reuse_conflict"},
                    )
                response = await self._archived_authorization_response(
                    db, user_id, archived_take
                )
                if response.take is not None:
                    await db.commit()
                    return response.take

        if auth.status == PerformanceTakeUploadAuthorizationStatus.FINALIZING:
            if auth.finalizing_expires_at and auth.finalizing_expires_at > now:
                await db.commit()
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR,
                    field="status",
                    details={"status": "FINALIZING", "reason": "finalize_in_progress"},
                )
        elif auth.status != PerformanceTakeUploadAuthorizationStatus.AUTHORIZED:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": auth.status.value},
            )
        if not self._authorization_matches_finalize_request(auth, request):
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": "finalize_request_mismatch"},
            )

        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")

        finalizing_token = str(uuid4())
        auth.status = PerformanceTakeUploadAuthorizationStatus.FINALIZING
        auth.finalizing_token = finalizing_token
        auth.finalizing_expires_at = now + timedelta(seconds=TAKE_FINALIZING_LEASE_SECONDS)
        auth.updated_at = now
        auth_snapshot = {
            "take_uuid": auth.take_uuid,
            "user_id": auth.user_id,
            "score_id": auth.score_id,
            "score_uuid": auth.score_uuid,
            "score_title": auth.score_title,
            "revision_id": auth.revision_id,
            "revision_uuid": auth.revision_uuid,
            "artifact_id": auth.artifact_id,
            "client_request_id": auth.client_request_id,
            "media_mime_type": auth.media_mime_type,
            "media_byte_size": auth.media_byte_size,
            "storage_backend": auth.storage_backend,
            "staging_object_key": auth.staging_object_key,
            "final_object_key": auth.final_object_key,
            "duration_ms": auth.duration_ms,
            "scope_type": auth.scope_type,
            "scope_start_beat": auth.scope_start_beat,
            "scope_terminal_beat": auth.scope_terminal_beat,
            "tempo_selection": auth.tempo_selection,
            "resolved_tempo_plan": auth.resolved_tempo_plan,
            "sync_metadata": auth.sync_metadata,
            "reservation_id": auth.reservation_id,
            "expires_at": auth.expires_at,
            "staging_cleanup_after": auth.staging_cleanup_after,
            "last_put_url_expires_at": auth.last_put_url_expires_at,
            "finalizing_token": finalizing_token,
        }
        await db.commit()

        final_exists = self.storage.exists(auth_snapshot["final_object_key"])
        staging_exists = self.storage.exists(auth_snapshot["staging_object_key"])
        if auth_snapshot["expires_at"] < now and not final_exists:
            auth = await self.repository.get_authorization_by_take_uuid(
                db, user_id, request.take_id, lock=True
            )
            if (
                auth is not None
                and auth.status == PerformanceTakeUploadAuthorizationStatus.FINALIZING
                and auth.finalizing_token == finalizing_token
            ):
                auth.status = PerformanceTakeUploadAuthorizationStatus.EXPIRED
                auth.finalizing_token = None
                auth.finalizing_expires_at = None
                auth.staging_cleanup_after = _max_datetime(
                    auth.staging_cleanup_after,
                    auth.last_put_url_expires_at,
                    utc_now_naive(),
                )
                auth.updated_at = utc_now_naive()
                await self.storage_usage_service.release_reservation(
                    db,
                    auth.reservation_id,
                    auto_commit=False,
                )
            await db.commit()
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="authorization_expired")

        source_key = (
            auth_snapshot["final_object_key"]
            if final_exists
            else auth_snapshot["staging_object_key"]
        )
        if not final_exists and not staging_exists:
            auth = await self.repository.get_authorization_by_take_uuid(
                db, user_id, request.take_id, lock=True
            )
            if (
                auth is not None
                and auth.status == PerformanceTakeUploadAuthorizationStatus.FINALIZING
                and auth.finalizing_token == finalizing_token
            ):
                auth.status = PerformanceTakeUploadAuthorizationStatus.AUTHORIZED
                auth.finalizing_token = None
                auth.finalizing_expires_at = None
                auth.updated_at = utc_now_naive()
                await db.commit()
            raise ResourceNotFoundException(
                "performance_take_media_object",
                auth_snapshot["take_uuid"],
                ErrorCode.FILE_NOT_FOUND,
            )

        metadata = self.storage.object_metadata(source_key)
        if metadata.size_bytes != auth_snapshot["media_byte_size"]:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")
        if (
            metadata.content_type is not None
            and metadata.content_type.split(";")[0].strip().lower()
            != auth_snapshot["media_mime_type"]
        ):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")

        header_bytes = b"".join(
            self.storage.iter_bytes(source_key, chunk_size=64, start=0, end=63)
        )
        if not _verify_audio_container_magic_bytes(
            header_bytes, auth_snapshot["media_mime_type"]
        ):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")

        if not final_exists:
            if not self.storage.exists(auth_snapshot["final_object_key"]):
                self.storage.copy(
                    auth_snapshot["staging_object_key"],
                    auth_snapshot["final_object_key"],
                )
            final_exists = True

        # Resolve score/revision at finalize time; if score deleted, keep score_title snapshot
        score = await db.get(Score, auth_snapshot["score_id"]) if auth_snapshot["score_id"] else None
        score_db_id: int | None = None
        score_title_out = auth_snapshot["score_title"]
        revision_db_id: int | None = None
        revision_obj: ScoreRevision | None = None
        if score is not None and score.deletion_status == ScoreDeletionStatus.ACTIVE:
            score_db_id = score.id
            score_title_out = score.title
            if auth_snapshot["revision_id"]:
                rev = await db.get(ScoreRevision, auth_snapshot["revision_id"])
                if rev is not None and rev.score_id == score.id:
                    revision_db_id = rev.id
                    revision_obj = rev

        auth = await self.repository.get_authorization_by_take_uuid(
            db, user_id, request.take_id, lock=True
        )
        if auth is None:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="reservation_id")
        existing_take = await self.repository.get_by_client_request_id(
            db, user_id, request.client_request_id
        )
        if existing_take is not None:
            if not self._take_matches_authorization(existing_take, auth):
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR,
                    field="client_request_id",
                    details={"reason": "client_request_id_reuse_conflict"},
                )
            response = await self._archived_authorization_response(db, user_id, existing_take)
            if response.take is not None:
                return response.take
        if (
            auth.status != PerformanceTakeUploadAuthorizationStatus.FINALIZING
            or auth.finalizing_token != finalizing_token
        ):
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": auth.status.value},
            )
        if not self._authorization_matches_finalize_request(auth, request):
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": "finalize_request_mismatch"},
            )
        if auth.expires_at < utc_now_naive() and not final_exists:
            auth.status = PerformanceTakeUploadAuthorizationStatus.EXPIRED
            auth.finalizing_token = None
            auth.finalizing_expires_at = None
            auth.staging_cleanup_after = _max_datetime(
                auth.staging_cleanup_after,
                auth.last_put_url_expires_at,
                utc_now_naive(),
            )
            auth.updated_at = utc_now_naive()
            await self.storage_usage_service.release_reservation(
                db,
                auth.reservation_id,
                auto_commit=False,
            )
            await db.commit()
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="authorization_expired")

        # Commit Take, Auth status, and Storage quota in ONE database transaction
        take = PerformanceTake(
            take_uuid=auth_snapshot["take_uuid"],
            user_id=auth.user_id,
            score_id=score_db_id,
            score_title=score_title_out,
            revision_id=revision_db_id,
            artifact_id=auth_snapshot["artifact_id"],
            client_request_id=auth_snapshot["client_request_id"],
            media_kind=PerformanceTakeMediaKind.AUDIO,
            media_mime_type=auth_snapshot["media_mime_type"],
            media_byte_size=auth_snapshot["media_byte_size"],
            media_object_key=auth_snapshot["final_object_key"],
            storage_backend=auth_snapshot["storage_backend"],
            duration_ms=auth_snapshot["duration_ms"],
            scope_type=auth_snapshot["scope_type"],
            scope_start_beat=auth_snapshot["scope_start_beat"],
            scope_terminal_beat=auth_snapshot["scope_terminal_beat"],
            deletion_status=PerformanceTakeDeletionStatus.ACTIVE,
            tempo_selection=auth_snapshot["tempo_selection"],
            resolved_tempo_plan=auth_snapshot["resolved_tempo_plan"],
            sync_metadata=auth_snapshot["sync_metadata"],
        )
        created = await self.repository.create_take(db, take, auto_commit=False)
        auth.status = PerformanceTakeUploadAuthorizationStatus.ARCHIVED
        auth.finalizing_token = None
        auth.finalizing_expires_at = None
        auth.staging_cleanup_after = _max_datetime(
            auth.staging_cleanup_after,
            auth.last_put_url_expires_at,
            utc_now_naive(),
        )
        auth.updated_at = utc_now_naive()

        await self.storage_usage_service.commit_reservation(
            db,
            reservation_id=auth.reservation_id,
            object_type="performance_take",
            object_id=auth_snapshot["take_uuid"],
            storage_key=auth_snapshot["final_object_key"],
            auto_commit=False,
        )
        await db.commit()

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
