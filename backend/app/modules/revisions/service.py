from __future__ import annotations
from app.storage import AsyncObjectStorage
from app.modules.storage_objects.writes import write_object_async

import hashlib
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ResourceNotFoundException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import (
    ScoreRevision,
    ScoreRevisionNote,
    StorageUsageCategory,
)
from app.db.models.score import RevisionOrigin
from app.modules.revisions.writer import (
    revision_writer,
    PreparedRevisionSource,
    AppendRevisionWrite,
    RestoreLineage,
)
from app.modules.revisions.fast_path import revision_fast_path
from app.modules.revisions.read_model import RevisionReadModel
from app.modules.revisions.schemas import (
    RevisionContentRead,
    RevisionCreateRequest,
    RevisionListRead,
    RevisionNoteUpdateRequest,
    RevisionRead,
    RevisionRestoreRequest,
)
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.score_assets.repository import ScoreAssetRepository
from app.modules.scores.repository import ScoreRepository
from app.modules.storage_usage.service import storage_usage_service
from app.processing.musicxml.admission import admit_musicxml_document
from app.shared.constants import ErrorCode
from app.storage import ObjectStorage, object_storage
from app.utils.timezone import utc_now_naive


class RevisionService:
    def __init__(
        self,
        repository: ScoreRepository | None = None,
        asset_repository: ScoreAssetRepository | None = None,
        storage: ObjectStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        read_model: RevisionReadModel | None = None,
    ) -> None:
        self.repository = repository or ScoreRepository()
        self.asset_repository = asset_repository or ScoreAssetRepository()
        self.storage = storage or object_storage
        self.async_storage = AsyncObjectStorage(self.storage)
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.read_model = read_model or RevisionReadModel()

    async def create(
        self, db: AsyncSession, score_uuid: str, user_id: int, request: RevisionCreateRequest
    ) -> RevisionRead:
        access = await self.access_policy.authorize(
            db, score_uuid, ScoreAction.EDIT, user_id=user_id
        )
        content = admit_musicxml_document(request.content.encode("utf-8"))
        return await self._append(
            db,
            score_uuid,
            user_id,
            content,
            expected_head_uuid=request.expected_head_revision_id,
            origin=request.origin,
            owner_user_id=access.score.owner_user_id,
            idempotency_key=request.idempotency_key,
        )

    async def _append(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        content: bytes,
        *,
        expected_head_uuid: str,
        origin: RevisionOrigin,
        owner_user_id: int,
        idempotency_key: str | None = None,
        restore: RestoreLineage | None = None,
    ) -> RevisionRead:
        existing = await db.run_sync(
            lambda sync: revision_writer.existing_append(
                sync,
                score_uuid=score_uuid,
                expected_head_uuid=expected_head_uuid,
                content_hash=hashlib.sha256(content).hexdigest(),
                idempotency_key=idempotency_key,
            )
        )
        if existing is not None:
            await db.commit()
            return await self._read(db, existing)
        revision_uuid = str(uuid.uuid4())
        reservation = await storage_usage_service.reserve(
            db,
            user_id=owner_user_id,
            category=StorageUsageCategory.SOURCE,
            bytes_count=len(content),
            reason="revision_restore" if restore else "revision_create",
            object_type="score_revision_source",
        )
        committed = False
        try:
            await db.commit()
            receipt = await write_object_async(
                db,
                self.async_storage,
                key=f"scores/{score_uuid}/revisions/{revision_uuid}/score.musicxml",
                content=content,
                content_type="application/vnd.recordare.musicxml+xml",
            )
            await self.access_policy.authorize(db, score_uuid, ScoreAction.EDIT, user_id=user_id)
            prepared = PreparedRevisionSource(
                revision_uuid,
                receipt,
                hashlib.sha256(content).hexdigest(),
                "restore" if restore else "editor",
                "1",
                reservation.reservation_id,
            )
            result = await db.run_sync(
                lambda sync: revision_writer.write(
                    sync,
                    AppendRevisionWrite(
                        score_uuid,
                        user_id,
                        prepared,
                        expected_head_uuid,
                        origin,
                        idempotency_key,
                        restore,
                    ),
                )
            )
            await db.commit()
            committed = True
            await revision_fast_path(result)
            return await self._read(db, result.revision)
        except Exception:
            await db.rollback()
            if not committed:
                await storage_usage_service.release_reservation(db, reservation.reservation_id)
                await db.commit()
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
            db, score_uuid, ScoreAction.EDIT, user_id=user_id
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
            db, score_uuid, ScoreAction.EDIT, user_id=user_id, revision_uuid=revision_uuid
        )
        target = access.revision
        head = await db.get(ScoreRevision, access.score.head_revision_id)
        if head is None:
            raise ResourceNotFoundException("revision", score_uuid, ErrorCode.REVISION_NOT_FOUND)
        source = await self.asset_repository.canonical_source(
            db, require_persisted_id(target.id, entity="revision")
        )
        if source is None:
            raise ResourceNotFoundException("source", revision_uuid, ErrorCode.FILE_NOT_FOUND)
        content = admit_musicxml_document(
            (await self.async_storage.read_bytes(source.stored_object.object_key))
        )
        return await self._append(
            db,
            score_uuid,
            user_id,
            content,
            expected_head_uuid=head.revision_uuid,
            origin=RevisionOrigin.EDIT,
            owner_user_id=access.score.owner_user_id,
            restore=RestoreLineage(revision_uuid, request.note if request else None),
        )

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
            raise ResourceNotFoundException("revision", revision_uuid, ErrorCode.REVISION_NOT_FOUND)
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
            ScoreAction.EDIT,
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
        content = (await self.async_storage.read_bytes(source.stored_object.object_key)).decode(
            "utf-8"
        )
        base = await self._read(db, revision)
        return RevisionContentRead(
            **base.model_dump(), content=content, mime_type=source.stored_object.content_type
        )

    async def _read(self, db: AsyncSession, revision: ScoreRevision) -> RevisionRead:
        return await self.read_model.revision_read(db, revision)
