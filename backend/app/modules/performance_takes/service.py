from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
import hashlib
import hmac
import json
import logging
from time import monotonic
from typing import Optional
from uuid import uuid4

from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.exc import DBAPIError, InterfaceError
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel

from app.core.config import settings
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
from app.db.models.practice_source_snapshot import (
    PracticeSourceSnapshot,
    PracticeSourceSnapshotStatus,
)
from app.db.models.practice_source_snapshot_delete_outbox import (
    PracticeSourceSnapshotDeleteOutbox,
    PracticeSourceSnapshotDeleteOutboxStatus,
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
    PerformanceTakeTempoPlan,
    PerformanceTakeUploadAuthorizationRead,
    PerformanceTakeUploadAuthorizationRequest,
    RecordingTimebase,
)
from app.modules.practice.source_schemas import (
    PracticeReadyScoreContentRead,
    PracticeScoreArtifactRead,
)
from app.modules.practice.source_service import PracticeSourceService
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
TAKE_UPLOAD_AUTHORIZATION_SECONDS = 3600
TAKE_FINALIZING_LEASE_SECONDS = 15 * 60
TAKE_FINALIZING_UNKNOWN_OUTCOME_GRACE_SECONDS = TAKE_FINALIZING_LEASE_SECONDS * 2
SOURCE_SNAPSHOT_CREATION_LEASE_SECONDS = 15 * 60
logger = logging.getLogger(__name__)
TERMINAL_UPLOAD_AUTHORIZATION_STATUSES = {
    PerformanceTakeUploadAuthorizationStatus.ARCHIVED.value,
    PerformanceTakeUploadAuthorizationStatus.CANCELLED.value,
    PerformanceTakeUploadAuthorizationStatus.EXPIRED.value,
}


def _status_value(status: object) -> str:
    value = getattr(status, "value", status)
    return str(value)


def _media_kind_value(media_kind: object) -> str:
    value = getattr(media_kind, "value", media_kind)
    return str(value or PerformanceTakeMediaKind.AUDIO.value).upper()


def _clean_mime_type(mime_type: str) -> str:
    return mime_type.split(";")[0].strip().lower()


def _clean_media_kind(media_kind: object) -> str:
    cleaned = _media_kind_value(media_kind)
    if cleaned not in {kind.value for kind in PerformanceTakeMediaKind}:
        raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_kind")
    return cleaned


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


def _build_final_object_key(user_id: int, take_uuid: str, mime_type: str) -> str:
    ext = _extension_for_mime(mime_type)
    return f"performance-takes/{user_id}/{take_uuid}/recording.{ext}"


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


def _json_snapshot(value: object | None, *, max_bytes: int = MAX_TAKE_METADATA_JSON_BYTES) -> str | None:
    if value is None:
        return None
    if isinstance(value, BaseModel):
        value = value.model_dump(mode="json", exclude_none=True)
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":"))
    if len(encoded.encode("utf-8")) > max_bytes:
        raise ValidationException(ErrorCode.VALIDATION_ERROR, field="metadata_size")
    return encoded


def _json_equivalent(left: str | None, right: object | None) -> bool:
    if isinstance(right, BaseModel):
        right = right.model_dump(mode="json", exclude_none=True)
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
    return [entry["key"] for entry in _load_orphan_final_entries(value) if entry.get("key")]


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


def _sha256_bytes(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


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
        self.storage = storage  # type: ignore[assignment]
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
        snapshot: PracticeSourceSnapshot,
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
            if can_open_score and score is not None and score.deletion_status == ScoreDeletionStatus.ACTIVE
            else None
        )

        scope_type = take.scope_type
        if scope_type not in {"FULL", "RANGE"}:
            raise ValidationException(
                "Performance take scope is invalid.",
                ErrorCode.VALIDATION_ERROR,
                field="scope_type",
                details={"reason": "scope_type_invalid"},
            )
        deletion_status = _status_value(take.deletion_status)

        return PerformanceTakeRead(
            take_id=take.take_uuid,
            source_score_id=snapshot.source_score_uuid,
            source_revision_id=snapshot.source_revision_uuid,
            source_artifact_id=snapshot.artifact_id,
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

    async def _archived_authorization_response(
        self,
        db: AsyncSession,
        take: PerformanceTake,
    ) -> PerformanceTakeUploadAuthorizationRead:
        snapshot = await db.get(PracticeSourceSnapshot, take.source_snapshot_id)
        if snapshot is None or snapshot.status != PracticeSourceSnapshotStatus.READY.value:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="source_snapshot_id")
        score = await db.get(Score, take.linked_score_id) if take.linked_score_id is not None else None
        can_open_score = await self._can_open_score(db, take.user_id, score)
        return PerformanceTakeUploadAuthorizationRead(
            take_id=take.take_uuid,
            status=PerformanceTakeUploadAuthorizationStatus.ARCHIVED.value,
            take=self._to_read_dto(
                take,
                snapshot=snapshot,
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

    def _authorization_matches_request(
        self,
        auth: PerformanceTakeUploadAuthorization,
        request: PerformanceTakeUploadAuthorizationRequest,
        cleaned_mime: str,
    ) -> bool:
        media_kind = _clean_media_kind(request.media_kind)
        return (
            auth.score_uuid == request.score_id
            and auth.revision_uuid == request.revision_id
            and auth.artifact_id == request.artifact_id
            and auth.scope_type == request.scope_type
            and auth.scope_start_beat == request.scope_start_beat
            and auth.scope_terminal_beat == request.scope_terminal_beat
            and auth.scope_start_group_id == request.scope_start_group_id
            and auth.scope_end_group_id == request.scope_end_group_id
            and auth.duration_ms == request.duration_ms
            and auth.media_kind == media_kind
            and auth.media_mime_type == cleaned_mime
            and auth.media_byte_size == request.media_byte_size
            and _json_equivalent(auth.tempo_plan, request.tempo_plan)
            and _json_equivalent(auth.recording_timebase, request.recording_timebase)
        )

    def _authorization_matches_finalize_request(
        self,
        auth: PerformanceTakeUploadAuthorization,
        request: PerformanceTakeCreateRequest,
    ) -> bool:
        cleaned_mime = _clean_mime_type(request.media_mime_type)
        media_kind = _clean_media_kind(request.media_kind)
        return (
            auth.score_uuid == request.score_id
            and auth.revision_uuid == request.revision_id
            and auth.artifact_id == request.artifact_id
            and auth.scope_type == request.scope_type
            and auth.scope_start_beat == request.scope_start_beat
            and auth.scope_terminal_beat == request.scope_terminal_beat
            and auth.scope_start_group_id == request.scope_start_group_id
            and auth.scope_end_group_id == request.scope_end_group_id
            and auth.duration_ms == request.duration_ms
            and auth.media_kind == media_kind
            and auth.media_mime_type == cleaned_mime
            and auth.media_byte_size == request.media_byte_size
            and _json_equivalent(auth.tempo_plan, request.tempo_plan)
            and _json_equivalent(auth.recording_timebase, request.recording_timebase)
        )

    def _take_matches_authorization(
        self,
        take: PerformanceTake,
        auth: PerformanceTakeUploadAuthorization,
    ) -> bool:
        snapshot_matches = (
            auth.source_snapshot_id is None
            or take.source_snapshot_id == auth.source_snapshot_id
        )
        return (
            take.take_uuid == auth.take_uuid
            and take.user_id == auth.user_id
            and snapshot_matches
            and take.client_request_id == auth.client_request_id
            and _media_kind_value(take.media_kind) == auth.media_kind
            and take.media_mime_type == auth.media_mime_type
            and take.media_byte_size == auth.media_byte_size
            and take.media_object_key == auth.final_object_key
            and take.storage_backend == auth.storage_backend
            and take.duration_ms == auth.duration_ms
            and take.scope_type == auth.scope_type
            and take.scope_start_beat == auth.scope_start_beat
            and take.scope_terminal_beat == auth.scope_terminal_beat
            and take.scope_start_group_id == auth.scope_start_group_id
            and take.scope_end_group_id == auth.scope_end_group_id
            and take.tempo_plan == auth.tempo_plan
            and take.recording_timebase == auth.recording_timebase
        )

    def _put_url_expires_at(self, now: datetime) -> datetime:
        return now + timedelta(seconds=settings.S3_PRESIGN_EXPIRE_SECONDS)

    async def _get_or_create_source_snapshot(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        score: Score,
        revision: ScoreRevision,
        artifact_id: str,
    ) -> PracticeSourceSnapshot:
        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")
        ready_content = await self.practice_source_service.get_practice_ready_score_content(
            db,
            score.score_uuid,
            user_id,
            revision.revision_uuid,
        )
        artifact = await self.practice_source_service.get_practice_score_artifact(
            db,
            score.score_uuid,
            user_id,
            revision.revision_uuid,
        )
        if (
            artifact.scoreId != score.score_uuid
            or artifact.revisionId != revision.revision_uuid
            or artifact.artifactId != artifact_id
        ):
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="artifact_id",
                details={"reason": "source_artifact_identity_mismatch"},
            )

        musicxml_bytes = ready_content.content.encode("utf-8")
        artifact_bytes = artifact.model_dump_json(by_alias=True).encode("utf-8")
        musicxml_sha = _sha256_bytes(musicxml_bytes)
        artifact_sha = _sha256_bytes(artifact_bytes)
        fingerprint = _sha256_bytes(
            "|".join(
                [
                    score.score_uuid,
                    revision.revision_uuid,
                    artifact.artifactId,
                    str(artifact.schemaVersion),
                    musicxml_sha,
                    artifact_sha,
                ]
            ).encode("utf-8")
        )

        existing = (
            await db.execute(
                select(PracticeSourceSnapshot).where(
                    PracticeSourceSnapshot.source_fingerprint == fingerprint
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            if existing.status != PracticeSourceSnapshotStatus.READY.value:
                raise ValidationException(
                    ErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                    field="source_snapshot",
                    details={"reason": "source_snapshot_not_ready"},
                )
            return existing

        musicxml_key = f"practice-source-snapshots/{fingerprint}/score.musicxml"
        artifact_key = f"practice-source-snapshots/{fingerprint}/artifact.json"
        snapshot = PracticeSourceSnapshot(
            source_fingerprint=fingerprint,
            source_score_uuid=score.score_uuid,
            source_revision_uuid=revision.revision_uuid,
            artifact_id=artifact.artifactId,
            artifact_schema_version=artifact.schemaVersion,
            prepared_musicxml_object_key=musicxml_key,
            prepared_musicxml_sha256=musicxml_sha,
            prepared_musicxml_byte_size=len(musicxml_bytes),
            artifact_object_key=artifact_key,
            artifact_sha256=artifact_sha,
            artifact_byte_size=len(artifact_bytes),
            status=PracticeSourceSnapshotStatus.CREATING.value,
            creation_expires_at=utc_now_naive()
            + timedelta(seconds=SOURCE_SNAPSHOT_CREATION_LEASE_SECONDS),
        )
        try:
            async with db.begin_nested():
                db.add(snapshot)
                await db.flush()
        except IntegrityError:
            existing = (
                await db.execute(
                    select(PracticeSourceSnapshot).where(
                        PracticeSourceSnapshot.source_fingerprint == fingerprint
                    )
                )
            ).scalar_one_or_none()
            if existing is not None:
                if existing.status != PracticeSourceSnapshotStatus.READY.value:
                    raise ValidationException(
                        ErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                        field="source_snapshot",
                        details={"reason": "source_snapshot_not_ready"},
                    )
                return existing
            raise
        await db.commit()
        await db.refresh(snapshot)

        try:
            await asyncio.to_thread(
                self.storage.put_bytes,
                key=musicxml_key,
                content=musicxml_bytes,
                content_type=ready_content.mime_type,
            )
            await asyncio.to_thread(
                self.storage.put_bytes,
                key=artifact_key,
                content=artifact_bytes,
                content_type="application/json",
            )
        except Exception as error:
            await self._enqueue_snapshot_delete_if_unreferenced(db, snapshot.id)
            await db.commit()
            raise ValidationException(
                ErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                field="source_snapshot",
                details={"reason": "source_snapshot_storage_write_failed"},
            ) from error

        locked_snapshot = (
            await db.execute(
                select(PracticeSourceSnapshot)
                .where(PracticeSourceSnapshot.id == snapshot.id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        now = utc_now_naive()
        if (
            locked_snapshot is None
            or locked_snapshot.status != PracticeSourceSnapshotStatus.CREATING.value
            or locked_snapshot.creation_expires_at is None
            or locked_snapshot.creation_expires_at <= now
        ):
            if locked_snapshot is not None:
                await self._enqueue_snapshot_delete_for_locked_snapshot(db, locked_snapshot)
            await db.commit()
            raise ValidationException(
                ErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                field="source_snapshot",
                details={"reason": "source_snapshot_creation_lease_expired"},
            )

        snapshot = locked_snapshot
        snapshot.status = PracticeSourceSnapshotStatus.READY.value
        snapshot.creation_expires_at = None
        await db.commit()
        await db.refresh(snapshot)
        return snapshot

    async def _lock_ready_source_snapshot(
        self,
        db: AsyncSession,
        snapshot_id: int | None,
    ) -> PracticeSourceSnapshot:
        if snapshot_id is None:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="source_snapshot_id")
        snapshot = (
            await db.execute(
                select(PracticeSourceSnapshot)
                .where(PracticeSourceSnapshot.id == snapshot_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if snapshot is None or snapshot.status != PracticeSourceSnapshotStatus.READY.value:
            raise ValidationException(
                ErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                field="source_snapshot",
                details={"reason": "source_snapshot_not_ready"},
            )
        return snapshot

    async def _enqueue_snapshot_delete_for_locked_snapshot(
        self,
        db: AsyncSession,
        snapshot: PracticeSourceSnapshot,
    ) -> PracticeSourceSnapshotDeleteOutbox | None:
        if snapshot.id is None or self.storage is None:
            return None
        take_refs = (
            await db.execute(
                select(func.count(PerformanceTake.id)).where(
                    PerformanceTake.source_snapshot_id == snapshot.id
                )
            )
        ).scalar_one()
        auth_refs = (
            await db.execute(
                select(func.count(PerformanceTakeUploadAuthorization.id)).where(
                    PerformanceTakeUploadAuthorization.source_snapshot_id == snapshot.id,
                    PerformanceTakeUploadAuthorization.status.notin_(
                        list(TERMINAL_UPLOAD_AUTHORIZATION_STATUSES)
                    ),
                )
            )
        ).scalar_one()
        if int(take_refs) + int(auth_refs) > 0:
            return None

        snapshot.status = PracticeSourceSnapshotStatus.DELETING.value
        snapshot.creation_expires_at = None
        existing = (
            await db.execute(
                select(PracticeSourceSnapshotDeleteOutbox).where(
                    PracticeSourceSnapshotDeleteOutbox.snapshot_uuid
                    == snapshot.snapshot_uuid,
                    PracticeSourceSnapshotDeleteOutbox.status
                    != PracticeSourceSnapshotDeleteOutboxStatus.COMPLETED.value,
                )
            )
        ).scalar_one_or_none()
        if existing is not None:
            return existing
        outbox = PracticeSourceSnapshotDeleteOutbox(
            source_snapshot_id=snapshot.id,
            snapshot_uuid=snapshot.snapshot_uuid,
            storage_backend=self.storage.backend_name,
            prepared_musicxml_object_key=snapshot.prepared_musicxml_object_key,
            artifact_object_key=snapshot.artifact_object_key,
            status=PracticeSourceSnapshotDeleteOutboxStatus.PENDING.value,
            max_attempts=settings.PERFORMANCE_TAKE_DELETE_OUTBOX_MAX_ATTEMPTS,
        )
        db.add(outbox)
        return outbox

    async def _enqueue_snapshot_delete_if_unreferenced(
        self,
        db: AsyncSession,
        snapshot_id: int | None,
    ) -> None:
        if snapshot_id is None or self.storage is None:
            return
        snapshot = (
            await db.execute(
                select(PracticeSourceSnapshot)
                .where(PracticeSourceSnapshot.id == snapshot_id)
                .with_for_update()
            )
        ).scalar_one_or_none()
        if snapshot is None:
            return
        await self._enqueue_snapshot_delete_for_locked_snapshot(db, snapshot)

    async def _ensure_finalize_copy_lease(
        self,
        db: AsyncSession,
        *,
        user_id: int,
        take_uuid: str,
        finalizing_token: str,
    ) -> None:
        auth = await self.repository.get_authorization_by_take_uuid(
            db,
            user_id,
            take_uuid,
            lock=True,
        )
        now = utc_now_naive()
        if (
            auth is None
            or _status_value(auth.status) != PerformanceTakeUploadAuthorizationStatus.FINALIZING.value
            or auth.finalizing_token != finalizing_token
            or auth.finalizing_expires_at is None
            or auth.finalizing_expires_at <= now
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
        auth = await self.repository.get_authorization_by_take_uuid(
            db,
            user_id,
            take_uuid,
            lock=True,
        )
        if auth is None:
            await db.commit()
            return
        keys = _load_orphan_final_keys(auth.orphan_final_object_keys)
        if candidate_key not in keys:
            auth.orphan_final_object_keys = _append_orphan_final_key(
                auth.orphan_final_object_keys,
                candidate_key,
                unknown_outcome=True,
            )
            auth.final_cleanup_completed_at = None
            auth.updated_at = utc_now_naive()
        await db.commit()

    def _delete_candidate_final_best_effort(self, candidate_key: str | None) -> None:
        if not candidate_key or self.storage is None:
            return
        try:
            if self.storage.exists(candidate_key):
                self.storage.delete(candidate_key)
        except Exception:
            logger.exception(
                "performance_take_upload.finalize_candidate_cleanup_failed",
                extra={"candidate_object_key": candidate_key},
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
        client_request_id: str,
        finalizing_token: str,
        candidate_key: str,
    ) -> None:
        """Release a failed finalize lease without guessing the transaction outcome."""
        async with AsyncSessionLocal() as recovery_db:
            auth = await self.repository.get_authorization_by_take_uuid(
                recovery_db, user_id, take_uuid, lock=True
            )
            existing_take = await self.repository.get_by_client_request_id(
                recovery_db, user_id, client_request_id
            )
            if existing_take is not None:
                await recovery_db.commit()
                return
            if (
                auth is None
                or _status_value(auth.status)
                != PerformanceTakeUploadAuthorizationStatus.FINALIZING.value
                or auth.finalizing_token != finalizing_token
            ):
                await recovery_db.commit()
                return
            auth.orphan_final_object_keys = _append_orphan_final_key(
                auth.orphan_final_object_keys,
                candidate_key,
                unknown_outcome=True,
            )
            auth.status = PerformanceTakeUploadAuthorizationStatus.AUTHORIZED.value
            auth.finalizing_token = None
            auth.finalizing_expires_at = None
            auth.finalizing_object_key = None
            auth.final_object_key = None
            auth.updated_at = utc_now_naive()
            await recovery_db.commit()

    async def _expire_authorization(
        self,
        db: AsyncSession,
        auth: PerformanceTakeUploadAuthorization,
    ) -> str:
        now = utc_now_naive()
        source_snapshot_id = auth.source_snapshot_id
        auth.status = PerformanceTakeUploadAuthorizationStatus.EXPIRED.value
        auth.source_snapshot_id = None
        auth.staging_cleanup_after = _max_datetime(
            auth.staging_cleanup_after,
            auth.last_put_url_expires_at,
            now,
        )
        auth.updated_at = now
        await self.storage_usage_service.release_reservation(
            db, auth.reservation_id, auto_commit=False
        )
        await self._enqueue_snapshot_delete_if_unreferenced(db, source_snapshot_id)
        await db.commit()
        return auth.staging_object_key

    async def authorize_upload(
        self,
        db: AsyncSession,
        user_id: int,
        request: PerformanceTakeUploadAuthorizationRequest,
    ) -> PerformanceTakeUploadAuthorizationRead:
        media_kind = _clean_media_kind(request.media_kind)
        cleaned_mime = _clean_mime_type(request.media_mime_type)
        if cleaned_mime not in _supported_mimes_for_kind(media_kind):
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

        _json_snapshot(request.tempo_plan)
        _json_snapshot(request.recording_timebase)
        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")

        existing_auth = await self.repository.get_authorization_by_client_request_id(
            db, user_id, request.client_request_id, lock=True
        )
        existing_take = await self.repository.get_by_client_request_id(
            db, user_id, request.client_request_id
        )
        if existing_take is not None:
            if (
                existing_auth is None
                or not self._authorization_matches_request(existing_auth, request, cleaned_mime)
                or not self._take_matches_authorization(existing_take, existing_auth)
            ):
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR,
                    field="client_request_id",
                    details={"reason": "client_request_id_reuse_conflict"},
                )
            return await self._archived_authorization_response(db, existing_take)

        if existing_auth is not None:
            if _status_value(existing_auth.status) == PerformanceTakeUploadAuthorizationStatus.ARCHIVED.value:
                archived_take = await self.repository.get_by_uuid(
                    db, user_id, existing_auth.take_uuid
                )
                if archived_take is not None:
                    if (
                        not self._authorization_matches_request(
                            existing_auth,
                            request,
                            cleaned_mime,
                        )
                        or not self._take_matches_authorization(
                            archived_take,
                            existing_auth,
                        )
                    ):
                        raise ValidationException(
                            ErrorCode.VALIDATION_ERROR,
                            field="client_request_id",
                            details={"reason": "client_request_id_reuse_conflict"},
                        )
                    return await self._archived_authorization_response(db, archived_take)
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR,
                    field="client_request_id",
                    details={"reason": "archived_authorization_missing_take"},
                )
            if _status_value(existing_auth.status) == PerformanceTakeUploadAuthorizationStatus.AUTHORIZED.value:
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
            if _status_value(existing_auth.status) == PerformanceTakeUploadAuthorizationStatus.FINALIZING.value:
                if not self._authorization_matches_request(existing_auth, request, cleaned_mime):
                    raise ValidationException(
                        ErrorCode.VALIDATION_ERROR,
                        field="client_request_id",
                        details={"reason": "client_request_id_reuse_conflict"},
                    )
                return PerformanceTakeUploadAuthorizationRead(
                    take_id=existing_auth.take_uuid,
                    status=PerformanceTakeUploadAuthorizationStatus.FINALIZING.value,
                    reservation_id=existing_auth.reservation_id,
                    expires_in=0,
                )
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": f"client_request_id_{_status_value(existing_auth.status).lower()}"},
            )

        score_stmt = select(Score).where(
            Score.score_uuid == request.score_id,
            Score.deletion_status == ScoreDeletionStatus.ACTIVE,
        )
        score_res = await db.execute(score_stmt)
        score = score_res.scalars().first()
        if not score:
            raise ResourceNotFoundException("score", request.score_id, ErrorCode.SCORE_NOT_FOUND)

        rev_stmt = select(ScoreRevision).where(
            ScoreRevision.revision_uuid == request.revision_id,
            ScoreRevision.score_id == score.id,
        )
        rev_res = await db.execute(rev_stmt)
        revision = rev_res.scalars().first()
        if not revision:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="revision_id")

        await self.score_access_policy.authorize(
            db,
            score.score_uuid,
            ScoreAction.PRACTICE,
            user_id=user_id,
            revision_uuid=revision.revision_uuid,
        )
        snapshot = await self._get_or_create_source_snapshot(
            db,
            user_id=user_id,
            score=score,
            revision=revision,
            artifact_id=request.artifact_id,
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

        snapshot = await self._lock_ready_source_snapshot(db, snapshot.id)

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
            source_snapshot_id=snapshot.id,
            client_request_id=request.client_request_id,
            take_uuid=take_uuid,
            score_id=score.id,
            score_uuid=score.score_uuid,
            score_title=score.title,
            revision_id=revision.id,
            revision_uuid=revision.revision_uuid,
            artifact_id=request.artifact_id,
            scope_type=request.scope_type,
            scope_start_beat=request.scope_start_beat,
            scope_terminal_beat=request.scope_terminal_beat,
            scope_start_group_id=request.scope_start_group_id,
            scope_end_group_id=request.scope_end_group_id,
            tempo_plan=_json_snapshot(request.tempo_plan),
            recording_timebase=_json_snapshot(request.recording_timebase),
            duration_ms=request.duration_ms,
            media_kind=media_kind,
            media_mime_type=cleaned_mime,
            media_byte_size=request.media_byte_size,
            storage_backend=self.storage.backend_name,
            staging_object_key=staging_object_key,
            final_object_key=final_object_key,
            reservation_id=reservation_handle.reservation_id,
            status=PerformanceTakeUploadAuthorizationStatus.AUTHORIZED.value,
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
        if auth is not None and _status_value(auth.status) == PerformanceTakeUploadAuthorizationStatus.AUTHORIZED.value:
            now = utc_now_naive()
            source_snapshot_id = auth.source_snapshot_id
            auth.status = PerformanceTakeUploadAuthorizationStatus.CANCELLED.value
            auth.source_snapshot_id = None
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
            await self._enqueue_snapshot_delete_if_unreferenced(db, source_snapshot_id)
            await db.commit()
        if (
            staging_key is not None
            and self.storage is not None
            and auth is not None
            and auth.staging_cleanup_after is not None
            and auth.staging_cleanup_after <= utc_now_naive()
        ):
            try:
                await asyncio.to_thread(self._delete_storage_object_if_exists, staging_key)
            except Exception:
                logger.exception(
                    "performance_take_upload_authorization.cancel_staging_delete_failed",
                    extra={"reservation_id": reservation_id, "staging_object_key": staging_key},
                )

    def _delete_storage_object_if_exists(self, key: str) -> None:
        if self.storage is not None and self.storage.exists(key):
            self.storage.delete(key)

    async def finalize_take(
        self,
        db: AsyncSession,
        user_id: int,
        request: PerformanceTakeCreateRequest,
    ) -> PerformanceTakeRead:
        finalize_started = monotonic()

        def log_stage(stage: str, *, started_at: float) -> None:
            logger.info(
                "performance_take.finalize.stage",
                extra={
                    "take_uuid": request.take_id,
                    "stage": stage,
                    "elapsed_ms": round((monotonic() - started_at) * 1000, 1),
                    "media_kind": request.media_kind,
                    "media_byte_size": request.media_byte_size,
                    "storage_backend": self.storage.__class__.__name__
                    if self.storage is not None
                    else None,
                },
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
            response = await self._archived_authorization_response(db, existing_take)
            if response.take is not None:
                await db.commit()
                return response.take

        now = utc_now_naive()
        if _status_value(auth.status) == PerformanceTakeUploadAuthorizationStatus.ARCHIVED.value:
            archived_take = await self.repository.get_by_uuid(db, user_id, auth.take_uuid)
            if archived_take is not None:
                if not self._authorization_matches_finalize_request(auth, request):
                    raise ValidationException(
                        ErrorCode.VALIDATION_ERROR,
                        field="client_request_id",
                        details={"reason": "client_request_id_reuse_conflict"},
                    )
                response = await self._archived_authorization_response(db, archived_take)
                if response.take is not None:
                    await db.commit()
                    return response.take

        takeover_orphan_entries = _load_orphan_final_entries(auth.orphan_final_object_keys)
        if _status_value(auth.status) == PerformanceTakeUploadAuthorizationStatus.FINALIZING.value:
            if auth.finalizing_expires_at and auth.finalizing_expires_at > now:
                await db.commit()
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR,
                    field="status",
                    details={"status": "FINALIZING", "reason": "finalize_in_progress"},
                )
            takeover_orphan_keys = {entry.get("key") for entry in takeover_orphan_entries}
            if auth.finalizing_object_key and auth.finalizing_object_key not in takeover_orphan_keys:
                takeover_orphan_entries.append(
                    {
                        "key": auth.finalizing_object_key,
                        "remove_after": (
                            now
                            + timedelta(seconds=TAKE_FINALIZING_UNKNOWN_OUTCOME_GRACE_SECONDS)
                        ).isoformat(),
                    }
                )
        elif _status_value(auth.status) != PerformanceTakeUploadAuthorizationStatus.AUTHORIZED.value:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": _status_value(auth.status)},
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
        finalizing_object_key = _build_final_candidate_object_key(
            auth.user_id,
            auth.take_uuid,
            finalizing_token,
            auth.media_mime_type,
        )
        auth.status = PerformanceTakeUploadAuthorizationStatus.FINALIZING.value
        auth.finalizing_token = finalizing_token
        auth.finalizing_expires_at = now + timedelta(seconds=TAKE_FINALIZING_LEASE_SECONDS)
        auth.finalizing_object_key = finalizing_object_key
        auth.final_object_key = finalizing_object_key
        auth.orphan_final_object_keys = _dump_orphan_final_entries(takeover_orphan_entries)
        auth.final_cleanup_completed_at = None
        auth.updated_at = now
        auth_snapshot = {
            "take_uuid": auth.take_uuid,
            "user_id": auth.user_id,
            "source_snapshot_id": auth.source_snapshot_id,
            "score_id": auth.score_id,
            "score_uuid": auth.score_uuid,
            "score_title": auth.score_title,
            "revision_id": auth.revision_id,
            "revision_uuid": auth.revision_uuid,
            "artifact_id": auth.artifact_id,
            "client_request_id": auth.client_request_id,
            "media_kind": auth.media_kind,
            "media_mime_type": auth.media_mime_type,
            "media_byte_size": auth.media_byte_size,
            "storage_backend": auth.storage_backend,
            "staging_object_key": auth.staging_object_key,
            "final_object_key": auth.final_object_key,
            "finalizing_object_key": auth.finalizing_object_key,
            "duration_ms": auth.duration_ms,
            "scope_type": auth.scope_type,
            "scope_start_beat": auth.scope_start_beat,
            "scope_terminal_beat": auth.scope_terminal_beat,
            "scope_start_group_id": auth.scope_start_group_id,
            "scope_end_group_id": auth.scope_end_group_id,
            "tempo_plan": auth.tempo_plan,
            "recording_timebase": auth.recording_timebase,
            "reservation_id": auth.reservation_id,
            "expires_at": auth.expires_at,
            "staging_cleanup_after": auth.staging_cleanup_after,
            "last_put_url_expires_at": auth.last_put_url_expires_at,
            "finalizing_token": finalizing_token,
        }
        await db.commit()
        log_stage("lease_acquired", started_at=finalize_started)

        staging_exists = await asyncio.to_thread(
            self.storage.exists, auth_snapshot["staging_object_key"]
        )
        if auth_snapshot["expires_at"] < now:
            auth = await self.repository.get_authorization_by_take_uuid(
                db, user_id, request.take_id, lock=True
            )
            if (
                auth is not None
                and _status_value(auth.status) == PerformanceTakeUploadAuthorizationStatus.FINALIZING.value
                and auth.finalizing_token == finalizing_token
            ):
                source_snapshot_id = auth.source_snapshot_id
                auth.status = PerformanceTakeUploadAuthorizationStatus.EXPIRED.value
                auth.source_snapshot_id = None
                auth.finalizing_token = None
                auth.finalizing_expires_at = None
                if auth.finalizing_object_key:
                    auth.orphan_final_object_keys = _append_orphan_final_key(
                        auth.orphan_final_object_keys,
                        auth.finalizing_object_key,
                        unknown_outcome=False,
                    )
                    auth.finalizing_object_key = None
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
                await self._enqueue_snapshot_delete_if_unreferenced(
                    db, source_snapshot_id
                )
            await db.commit()
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="authorization_expired")

        source_key = auth_snapshot["staging_object_key"]
        if not staging_exists:
            auth = await self.repository.get_authorization_by_take_uuid(
                db, user_id, request.take_id, lock=True
            )
            if (
                auth is not None
                and _status_value(auth.status) == PerformanceTakeUploadAuthorizationStatus.FINALIZING.value
                and auth.finalizing_token == finalizing_token
            ):
                auth.status = PerformanceTakeUploadAuthorizationStatus.AUTHORIZED.value
                auth.finalizing_token = None
                auth.finalizing_expires_at = None
                if auth.finalizing_object_key:
                    auth.orphan_final_object_keys = _append_orphan_final_key(
                        auth.orphan_final_object_keys,
                        auth.finalizing_object_key,
                        unknown_outcome=False,
                    )
                    auth.finalizing_object_key = None
                auth.updated_at = utc_now_naive()
                await db.commit()
            raise ResourceNotFoundException(
                "performance_take_media_object",
                auth_snapshot["take_uuid"],
                ErrorCode.FILE_NOT_FOUND,
            )

        metadata = await asyncio.to_thread(self.storage.object_metadata, source_key)
        if metadata.size_bytes != auth_snapshot["media_byte_size"]:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_byte_size")
        if (
            metadata.content_type is not None
            and metadata.content_type.split(";")[0].strip().lower()
            != auth_snapshot["media_mime_type"]
        ):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")

        header_bytes = await asyncio.to_thread(
            lambda: b"".join(
                self.storage.iter_bytes(source_key, chunk_size=64, start=0, end=63)
            )
        )
        if not _verify_container_magic_bytes(
            header_bytes,
            auth_snapshot["media_mime_type"],
            auth_snapshot["media_kind"],
        ):
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="media_mime_type")
        verified_staging_sha256 = await asyncio.to_thread(
            _sha256_storage_object,
            self.storage,
            auth_snapshot["staging_object_key"],
        )
        log_stage("staging_verified", started_at=finalize_started)
        log_stage("staging_hash_complete", started_at=finalize_started)

        candidate_key = auth_snapshot["finalizing_object_key"]
        try:
            await self._ensure_finalize_copy_lease(
                db,
                user_id=user_id,
                take_uuid=request.take_id,
                finalizing_token=finalizing_token,
            )
            await asyncio.to_thread(
                self.storage.copy,
                auth_snapshot["staging_object_key"],
                candidate_key,
            )
            candidate_metadata = await asyncio.to_thread(
                self.storage.object_metadata, candidate_key
            )
            if candidate_metadata.size_bytes != auth_snapshot["media_byte_size"]:
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
                take_uuid=request.take_id,
                candidate_key=candidate_key,
            )
            await self._delete_candidate_final_async(candidate_key)
            raise
        log_stage("candidate_hash_complete", started_at=finalize_started)

        # Source durability was decided at upload authorization time. Finalize
        # consumes that pinned snapshot and must not require live Score access:
        # owner deletion, member removal, or grant expiry after authorization do
        # not invalidate this already-authorized save.
        async def load_pinned_source_and_live_score() -> tuple[
            PracticeSourceSnapshot | None,
            Score | None,
        ]:
            pinned_snapshot = await db.get(
                PracticeSourceSnapshot,
                auth_snapshot["source_snapshot_id"],
            )
            linked_score = (
                await db.get(Score, auth_snapshot["score_id"])
                if auth_snapshot["score_id"]
                else None
            )
            return pinned_snapshot, linked_score

        try:
            snapshot, score = await load_pinned_source_and_live_score()
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
                extra={"take_uuid": request.take_id, "stage": "db_finalize_started"},
            )
            snapshot, score = await load_pinned_source_and_live_score()
        log_stage("db_finalize_started", started_at=finalize_started)
        if snapshot is None or snapshot.status != PracticeSourceSnapshotStatus.READY.value:
            await self._record_failed_candidate_final(
                db,
                user_id=user_id,
                take_uuid=request.take_id,
                candidate_key=candidate_key,
            )
            await self._delete_candidate_final_async(candidate_key)
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="source_snapshot_id")

        can_open_score = await self._can_open_score(db, user_id, score)
        score_db_id: int | None = score.id if score is not None else None
        score_title_out = auth_snapshot["score_title"]

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
            response = await self._archived_authorization_response(db, existing_take)
            if response.take is not None:
                return response.take
        if (
            _status_value(auth.status) != PerformanceTakeUploadAuthorizationStatus.FINALIZING.value
            or auth.finalizing_token != finalizing_token
            or auth.finalizing_object_key != candidate_key
            or auth.finalizing_expires_at is None
            or auth.finalizing_expires_at <= utc_now_naive()
        ):
            await self._record_failed_candidate_final(
                db,
                user_id=user_id,
                take_uuid=request.take_id,
                candidate_key=candidate_key,
            )
            await self._delete_candidate_final_async(candidate_key)
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="status",
                details={"status": _status_value(auth.status)},
            )
        if not self._authorization_matches_finalize_request(auth, request):
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="client_request_id",
                details={"reason": "finalize_request_mismatch"},
            )
        if auth.expires_at < utc_now_naive():
            await self._delete_candidate_final_async(candidate_key)
            source_snapshot_id = auth.source_snapshot_id
            auth.orphan_final_object_keys = _append_orphan_final_key(
                auth.orphan_final_object_keys,
                candidate_key,
                unknown_outcome=False,
            )
            auth.status = PerformanceTakeUploadAuthorizationStatus.EXPIRED.value
            auth.source_snapshot_id = None
            auth.finalizing_token = None
            auth.finalizing_expires_at = None
            auth.finalizing_object_key = None
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
            await self._enqueue_snapshot_delete_if_unreferenced(db, source_snapshot_id)
            await db.commit()
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="authorization_expired")

        # Commit Take, Auth status, and Storage quota in ONE database transaction
        take = PerformanceTake(
            take_uuid=auth_snapshot["take_uuid"],
            user_id=auth.user_id,
            source_snapshot_id=snapshot.id,
            linked_score_id=score_db_id,
            score_title_snapshot=score_title_out,
            client_request_id=auth_snapshot["client_request_id"],
            media_kind=PerformanceTakeMediaKind(auth_snapshot["media_kind"]),
            media_mime_type=auth_snapshot["media_mime_type"],
            media_byte_size=auth_snapshot["media_byte_size"],
            media_object_key=candidate_key,
            storage_backend=auth_snapshot["storage_backend"],
            duration_ms=auth_snapshot["duration_ms"],
            scope_type=auth_snapshot["scope_type"],
            scope_start_beat=auth_snapshot["scope_start_beat"],
            scope_terminal_beat=auth_snapshot["scope_terminal_beat"],
            scope_start_group_id=auth_snapshot["scope_start_group_id"],
            scope_end_group_id=auth_snapshot["scope_end_group_id"],
            deletion_status=PerformanceTakeDeletionStatus.ACTIVE.value,
            tempo_plan=auth_snapshot["tempo_plan"],
            recording_timebase=auth_snapshot["recording_timebase"],
        )
        created = await self.repository.create_take(db, take, auto_commit=False)
        auth.status = PerformanceTakeUploadAuthorizationStatus.ARCHIVED.value
        auth.source_snapshot_id = None
        auth.finalizing_token = None
        auth.finalizing_expires_at = None
        auth.finalizing_object_key = None
        auth.final_object_key = candidate_key
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
                take_uuid=request.take_id,
                client_request_id=request.client_request_id,
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
            snapshot=snapshot,
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

        snapshot_ids = {item.source_snapshot_id for item in items}
        snapshot_map: dict[int, PracticeSourceSnapshot] = {}
        if snapshot_ids:
            snapshots_res = await db.execute(
                select(PracticeSourceSnapshot).where(PracticeSourceSnapshot.id.in_(snapshot_ids))
            )
            for snapshot in snapshots_res.scalars().all():
                if snapshot.id is not None:
                    snapshot_map[snapshot.id] = snapshot

        read_items: list[PerformanceTakeRead] = []
        for item in items:
            score_obj = score_map.get(item.linked_score_id) if item.linked_score_id is not None else None
            snapshot = snapshot_map.get(item.source_snapshot_id)
            if snapshot is None or snapshot.status != PracticeSourceSnapshotStatus.READY.value:
                continue
            can_open_score = await self._can_open_score(db, user_id, score_obj)
            read_items.append(
                self._to_read_dto(
                    item,
                    snapshot=snapshot,
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
            raise ResourceNotFoundException("performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND)

        snapshot = await db.get(PracticeSourceSnapshot, take.source_snapshot_id)
        if snapshot is None or snapshot.status != PracticeSourceSnapshotStatus.READY.value:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="source_snapshot_id")
        score = await db.get(Score, take.linked_score_id) if take.linked_score_id is not None else None
        can_open_score = await self._can_open_score(db, user_id, score)

        return self._to_read_dto(take, snapshot=snapshot, score=score, can_open_score=can_open_score)

    async def get_playback_url(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> PerformanceTakePlaybackRead:
        take = await self.repository.get_by_uuid(db, user_id, take_id)
        if take is None or _status_value(take.deletion_status) == PerformanceTakeDeletionStatus.DELETING.value:
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
        if take is None or _status_value(take.deletion_status) == PerformanceTakeDeletionStatus.DELETING.value:
            raise ResourceNotFoundException("performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND)
        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")
        extension = _extension_for_mime(take.media_mime_type)
        return (
            take.media_object_key,
            f"performance-{take.take_uuid}.{extension}",
            take.media_mime_type,
        )

    async def get_practice_source_content(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> PracticeReadyScoreContentRead:
        take = await self.repository.get_by_uuid(db, user_id, take_id)
        if take is None or _status_value(take.deletion_status) == PerformanceTakeDeletionStatus.DELETING.value:
            raise ResourceNotFoundException("performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND)
        snapshot = await db.get(PracticeSourceSnapshot, take.source_snapshot_id)
        if snapshot is None or snapshot.status != PracticeSourceSnapshotStatus.READY.value:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="source_snapshot_id")
        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")
        content_bytes = await asyncio.to_thread(
            self.storage.read_bytes,
            snapshot.prepared_musicxml_object_key,
        )
        if _sha256_bytes(content_bytes) != snapshot.prepared_musicxml_sha256:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="source_snapshot",
                details={"reason": "prepared_musicxml_checksum_mismatch"},
            )
        return PracticeReadyScoreContentRead(
            score_id=snapshot.source_score_uuid,
            revision_id=snapshot.source_revision_uuid,
            content=content_bytes.decode("utf-8"),
        )

    async def get_practice_source_artifact(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> PracticeScoreArtifactRead:
        take = await self.repository.get_by_uuid(db, user_id, take_id)
        if take is None or _status_value(take.deletion_status) == PerformanceTakeDeletionStatus.DELETING.value:
            raise ResourceNotFoundException("performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND)
        snapshot = await db.get(PracticeSourceSnapshot, take.source_snapshot_id)
        if snapshot is None or snapshot.status != PracticeSourceSnapshotStatus.READY.value:
            raise ValidationException(ErrorCode.VALIDATION_ERROR, field="source_snapshot_id")
        if self.storage is None:
            raise ValidationException(ErrorCode.STORAGE_BACKEND_UNAVAILABLE, field="storage")
        artifact_bytes = await asyncio.to_thread(
            self.storage.read_bytes,
            snapshot.artifact_object_key,
        )
        if _sha256_bytes(artifact_bytes) != snapshot.artifact_sha256:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="source_snapshot",
                details={"reason": "artifact_checksum_mismatch"},
            )
        artifact = PracticeScoreArtifactRead.model_validate_json(artifact_bytes)
        if (
            artifact.scoreId != snapshot.source_score_uuid
            or artifact.revisionId != snapshot.source_revision_uuid
            or artifact.artifactId != snapshot.artifact_id
        ):
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="source_snapshot",
                details={"reason": "artifact_identity_mismatch"},
            )
        return artifact

    async def delete_take(
        self,
        db: AsyncSession,
        user_id: int,
        take_id: str,
    ) -> dict[str, str]:
        take = await self.repository.get_by_uuid(db, user_id, take_id, lock=True)
        if take is None:
            raise ResourceNotFoundException("performance_take", take_id, ErrorCode.RESOURCE_NOT_FOUND)

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
