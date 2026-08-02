from __future__ import annotations

import hashlib
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import col

from app.core.exceptions import (
    ConflictException,
    ResourceNotFoundException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    ScoreRevision,
    ScoreRevisionEvent,
    ScoreRevisionMetadata,
    ScoreRevisionNote,
    ScoreRevisionSource,
    StorageUsageCategory,
    User,
)
from app.db.models.score import MetadataStatus, RevisionOrigin, RevisionSourceFormat
from app.modules.revisions.schemas import (
    RevisionActorRead,
    RevisionContentRead,
    RevisionCreateRequest,
    RevisionListRead,
    RevisionNoteRead,
    RevisionNoteUpdateRequest,
    RevisionRead,
    RevisionRestoreRead,
    RevisionRestoreRequest,
)
from app.modules.notifications.service import NotificationService
from app.processing.musicxml.validation import validate_musicxml_document
from app.modules.realtime.publisher import RealtimeEventTypes, publish_score_event_best_effort
from app.modules.revisions.derivatives import revision_derivative_service
from app.modules.revisions.derived_asset_retention_service import (
    derived_asset_retention_service,
)
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.scores.repository import ScoreRepository
from app.modules.storage_usage.service import storage_usage_service
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


class RevisionService:
    def __init__(
        self,
        repository: ScoreRepository | None = None,
        asset_repository: ScoreAssetRepository | None = None,
        storage: FileStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        notification_service: NotificationService | None = None,
    ) -> None:
        self.repository = repository or ScoreRepository()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.storage = storage or file_storage
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.notification_service = notification_service or NotificationService()

    async def create(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        request: RevisionCreateRequest,
    ) -> RevisionRead:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.EDIT, user_id=user_id
        )
        score = await self.repository.get(db, access.score.score_uuid, lock=True)
        assert score is not None

        score_id = require_persisted_id(score.id, entity="score")
        content = request.content.encode("utf-8")
        validate_musicxml_document(content)
        content_hash = hashlib.sha256(content).hexdigest()

        if request.idempotency_key:
            existing = (
                await db.execute(
                    select(ScoreRevision).where(
                        ScoreRevision.score_id == score_id,
                        ScoreRevision.idempotency_key == request.idempotency_key,
                    )
                )
            ).scalar_one_or_none()
            if existing:
                return await self._read(db, existing)

        base = await self.repository.revision(db, request.base_revision_id)
        if not base or base.score_id != score_id:
            raise ResourceNotFoundException(
                "revision", request.base_revision_id, ErrorCode.REVISION_NOT_FOUND
            )
        if score.head_revision_id != base.id:
            head = await db.get(ScoreRevision, score.head_revision_id)
            raise ConflictException(
                ErrorCode.REVISION_CONFLICT,
                {
                    "score_id": score_uuid,
                    "base_revision_id": request.base_revision_id,
                    "head_revision_id": head.revision_uuid if head else None,
                },
            )
        if base.content_hash == content_hash:
            return await self._read(db, base)

        storage_owner_user_id = score.owner_user_id
        revision_uuid = str(uuid.uuid4())
        key = f"scores/{score_uuid}/revisions/{revision_uuid}/score.musicxml"
        reservation = await storage_usage_service.reserve(
            db,
            user_id=storage_owner_user_id,
            category=StorageUsageCategory.SOURCE,
            bytes_count=len(content),
            reason="revision_create",
            object_type="score_revision_source",
        )
        business_committed = False
        try:
            stored = self.storage.put_bytes(
                key=key,
                content=content,
                content_type="application/vnd.recordare.musicxml+xml",
            )
        except Exception:
            await storage_usage_service.release_reservation(db, reservation.reservation_id)
            raise
        try:
            source_uuid = str(uuid.uuid4())
            revision = ScoreRevision(
                revision_uuid=revision_uuid,
                score_id=score_id,
                revision_number=base.revision_number + 1,
                parent_revision_id=base.id,
                base_revision_id=base.id,
                content_hash=content_hash,
                idempotency_key=request.idempotency_key,
                origin=request.origin,
                created_by_user_id=user_id,
                created_at=utc_now_naive(),
            )
            db.add(revision)
            await db.flush()
            revision_id = require_persisted_id(revision.id, entity="score revision")
            db.add(
                ScoreRevisionSource(
                    source_uuid=source_uuid,
                    revision_id=revision_id,
                    format=RevisionSourceFormat.MUSICXML,
                    storage_backend=self.storage.backend_name,
                    storage_key=stored.storage_key,
                    filename=stored.filename,
                    mime_type="application/vnd.recordare.musicxml+xml",
                    size_bytes=stored.size_bytes,
                    sha256=content_hash,
                    generator="editor",
                    generator_version="1",
                )
            )
            db.add(
                ScoreRevisionMetadata(
                    revision_id=revision_id,
                    status=MetadataStatus.PENDING,
                    extractor_version="pending",
                )
            )
            await revision_derivative_service.enqueue(
                db,
                score_id=score_id,
                revision_id=revision_id,
                requested_by_user_id=user_id,
                source_fingerprint=content_hash,
            )
            score.head_revision_id = revision_id
            score.version += 1
            score.updated_at = utc_now_naive()
            await db.commit()
            business_committed = True
            await storage_usage_service.commit_reservation(
                db,
                reservation.reservation_id,
                object_type="score_revision_source",
                object_id=source_uuid,
                storage_key=stored.storage_key,
            )
            await db.refresh(revision)
            actor = await db.get(User, user_id)
            if actor is not None:
                await self.notification_service.notify_score_version_created_best_effort(
                    db,
                    score=score,
                    revision=revision,
                    actor=actor,
                )
            await publish_score_event_best_effort(
                db,
                score_id=score.score_uuid,
                revision_id=revision.revision_uuid,
                type=RealtimeEventTypes.SCORE_REVISION_CREATED,
                payload={},
            )
            await revision_derivative_service.rebuild_metadata_best_effort(
                db,
                score_uuid=score_uuid,
                revision_uuid=revision_uuid,
                user_id=user_id,
                storage=self.storage,
            )
            await derived_asset_retention_service.cleanup_for_score_best_effort(
                db,
                score_id=score_id,
                head_revision_id=revision_id,
            )
            return await self._read(db, revision)
        except Exception:
            await db.rollback()
            if not business_committed:
                try:
                    self.storage.delete(stored.storage_key)
                except Exception:
                    pass
                await storage_usage_service.release_reservation(db, reservation.reservation_id)
            raise

    async def list(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        *,
        limit: int,
        cursor: int | None = None,
    ) -> RevisionListRead:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.VIEW, user_id=user_id
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        revisions, next_cursor = await self.repository.revisions(
            db, score_id, limit=limit, cursor=cursor
        )
        return RevisionListRead(
            items=[await self._read(db, revision) for revision in revisions],
            next_cursor=next_cursor,
        )

    async def restore(
        self,
        db: AsyncSession,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
        request: RevisionRestoreRequest | None = None,
    ) -> RevisionRead:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.EDIT,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        score = await self.repository.get(db, access.score.score_uuid, lock=True)
        assert score is not None
        score_id = require_persisted_id(score.id, entity="score")
        target = await self.repository.revision(db, revision_uuid)
        if not target or target.score_id != score_id:
            raise ResourceNotFoundException(
                "revision", revision_uuid, ErrorCode.REVISION_NOT_FOUND
            )
        head = await db.get(ScoreRevision, score.head_revision_id)
        if head is None:
            raise ResourceNotFoundException(
                "revision", revision_uuid, ErrorCode.REVISION_NOT_FOUND
            )
        if head.id == target.id:
            return await self._read(db, head)

        source = await self.asset_repository.canonical_source(
            db, require_persisted_id(target.id, entity="score revision")
        )
        if not source:
            raise ResourceNotFoundException(
                "source", revision_uuid, ErrorCode.FILE_NOT_FOUND
            )
        content = self.storage.read_bytes(source.storage_key)
        validate_musicxml_document(content)
        content_hash = hashlib.sha256(content).hexdigest()
        storage_owner_user_id = score.owner_user_id
        new_revision_uuid = str(uuid.uuid4())
        key = f"scores/{score_uuid}/revisions/{new_revision_uuid}/score.musicxml"
        reservation = await storage_usage_service.reserve(
            db,
            user_id=storage_owner_user_id,
            category=StorageUsageCategory.SOURCE,
            bytes_count=len(content),
            reason="revision_restore",
            object_type="score_revision_source",
        )
        business_committed = False
        try:
            stored = self.storage.put_bytes(
                key=key,
                content=content,
                content_type="application/vnd.recordare.musicxml+xml",
            )
        except Exception:
            await storage_usage_service.release_reservation(db, reservation.reservation_id)
            raise
        try:
            source_uuid = str(uuid.uuid4())
            revision = ScoreRevision(
                revision_uuid=new_revision_uuid,
                score_id=score_id,
                revision_number=head.revision_number + 1,
                parent_revision_id=head.id,
                base_revision_id=target.id,
                content_hash=content_hash,
                origin=RevisionOrigin.EDIT,
                created_by_user_id=user_id,
                created_at=utc_now_naive(),
            )
            db.add(revision)
            await db.flush()
            revision_id = require_persisted_id(revision.id, entity="score revision")
            db.add(
                ScoreRevisionSource(
                    source_uuid=source_uuid,
                    revision_id=revision_id,
                    format=RevisionSourceFormat.MUSICXML,
                    storage_backend=self.storage.backend_name,
                    storage_key=stored.storage_key,
                    filename=stored.filename,
                    mime_type=source.mime_type,
                    size_bytes=stored.size_bytes,
                    sha256=content_hash,
                    generator="restore",
                    generator_version="1",
                )
            )
            db.add(
                ScoreRevisionMetadata(
                    revision_id=revision_id,
                    status=MetadataStatus.PENDING,
                    extractor_version="pending",
                )
            )
            note = request.note.strip() if request and request.note else None
            db.add(
                ScoreRevisionEvent(
                    score_id=score_id,
                    revision_id=revision_id,
                    target_revision_id=target.id,
                    actor_user_id=user_id,
                    type="RESTORE",
                    note=note or None,
                    created_at=utc_now_naive(),
                )
            )
            await revision_derivative_service.enqueue(
                db,
                score_id=score_id,
                revision_id=revision_id,
                requested_by_user_id=user_id,
                source_fingerprint=content_hash,
            )
            score.head_revision_id = revision_id
            score.version += 1
            score.updated_at = utc_now_naive()
            await db.commit()
            business_committed = True
            await storage_usage_service.commit_reservation(
                db,
                reservation.reservation_id,
                object_type="score_revision_source",
                object_id=source_uuid,
                storage_key=stored.storage_key,
            )
            await db.refresh(revision)
            actor = await db.get(User, user_id)
            if actor is not None:
                await self.notification_service.notify_score_version_created_best_effort(
                    db,
                    score=score,
                    revision=revision,
                    actor=actor,
                )
            await publish_score_event_best_effort(
                db,
                score_id=score.score_uuid,
                revision_id=revision.revision_uuid,
                type=RealtimeEventTypes.SCORE_REVISION_CREATED,
                payload={},
            )
            await revision_derivative_service.rebuild_metadata_best_effort(
                db,
                score_uuid=score_uuid,
                revision_uuid=new_revision_uuid,
                user_id=user_id,
                storage=self.storage,
            )
            await derived_asset_retention_service.cleanup_for_score_best_effort(
                db,
                score_id=score_id,
                head_revision_id=revision_id,
            )
            return await self._read(db, revision)
        except Exception:
            await db.rollback()
            if not business_committed:
                try:
                    self.storage.delete(stored.storage_key)
                except Exception:
                    pass
                await storage_usage_service.release_reservation(db, reservation.reservation_id)
            raise

    async def update_note(
        self,
        db: AsyncSession,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
        request: RevisionNoteUpdateRequest,
    ) -> RevisionRead:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.EDIT,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        revision = await self.repository.revision(db, revision_uuid)
        if not revision or revision.score_id != score_id:
            raise ResourceNotFoundException(
                "revision", revision_uuid, ErrorCode.REVISION_NOT_FOUND
            )
        revision_id = require_persisted_id(revision.id, entity="score revision")
        note_text = request.note.strip() if request.note else ""
        existing = (
            await db.execute(
                select(ScoreRevisionNote).where(ScoreRevisionNote.revision_id == revision_id)
            )
        ).scalar_one_or_none()
        if note_text:
            if existing is None:
                db.add(
                    ScoreRevisionNote(
                        score_id=score_id,
                        revision_id=revision_id,
                        author_user_id=user_id,
                        note=note_text,
                        created_at=utc_now_naive(),
                        updated_at=utc_now_naive(),
                    )
                )
            else:
                existing.author_user_id = user_id
                existing.note = note_text
                existing.updated_at = utc_now_naive()
        elif existing is not None:
            await db.delete(existing)
        await db.commit()
        await db.refresh(revision)
        return await self._read(db, revision)

    async def content(
        self, db: AsyncSession, score_uuid: str, revision_uuid: str, user_id: int
    ) -> RevisionContentRead:
        access = await self.access_policy.authorize(
            db,
            score_uuid,
            ScoreAction.VIEW,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        score = access.score
        revision = await self.repository.revision(db, revision_uuid)
        if not revision or revision.score_id != score.id:
            raise ResourceNotFoundException("revision", revision_uuid, ErrorCode.REVISION_NOT_FOUND)
        source = await self.asset_repository.canonical_source(
            db, require_persisted_id(revision.id, entity="score revision")
        )
        if not source:
            raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)
        content = self.storage.read_bytes(source.storage_key).decode("utf-8")
        base = await self._read(db, revision)
        return RevisionContentRead(**base.model_dump(), content=content, mime_type=source.mime_type)

    async def _read(self, db: AsyncSession, revision: ScoreRevision) -> RevisionRead:
        actor = await db.get(User, revision.created_by_user_id) if revision.created_by_user_id else None
        restore = await self._restore_read(db, revision)
        note = await self._note_read(db, revision)
        return RevisionRead(
            revision_id=revision.revision_uuid,
            revision_number=revision.revision_number,
            origin=revision.origin,
            created_at=revision.created_at,
            created_by=RevisionActorRead(
                display_name=actor.display_name,
                email=actor.email,
                avatar_url=actor.avatar_url,
            ) if actor else None,
            restore=restore,
            note=note,
        )

    async def _restore_read(
        self, db: AsyncSession, revision: ScoreRevision
    ) -> RevisionRestoreRead | None:
        revision_id = require_persisted_id(revision.id, entity="score revision")
        event = (
            await db.execute(
                select(ScoreRevisionEvent)
                .where(
                    ScoreRevisionEvent.revision_id == revision_id,
                    ScoreRevisionEvent.type == "RESTORE",
                )
                .order_by(col(ScoreRevisionEvent.created_at).desc())
                .limit(1)
            )
        ).scalar_one_or_none()
        if event is None:
            return None
        target = await db.get(ScoreRevision, event.target_revision_id) if event.target_revision_id else None
        actor = await db.get(User, event.actor_user_id) if event.actor_user_id else None
        return RevisionRestoreRead(
            restored_from_revision_id=target.revision_uuid if target else None,
            restored_from_revision_number=target.revision_number if target else None,
            note=event.note,
            actor=RevisionActorRead(
                display_name=actor.display_name,
                email=actor.email,
                avatar_url=actor.avatar_url,
            ) if actor else None,
            created_at=event.created_at,
        )

    async def _note_read(
        self, db: AsyncSession, revision: ScoreRevision
    ) -> RevisionNoteRead | None:
        revision_id = require_persisted_id(revision.id, entity="score revision")
        note = (
            await db.execute(
                select(ScoreRevisionNote).where(ScoreRevisionNote.revision_id == revision_id)
            )
        ).scalar_one_or_none()
        if note is None:
            return None
        author = await db.get(User, note.author_user_id) if note.author_user_id else None
        return RevisionNoteRead(
            note=note.note,
            author=RevisionActorRead(
                display_name=author.display_name,
                email=author.email,
                avatar_url=author.avatar_url,
            ) if author else None,
            updated_at=note.updated_at,
        )
