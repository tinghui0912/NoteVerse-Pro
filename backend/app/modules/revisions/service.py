from __future__ import annotations

import hashlib
import uuid
import xml.etree.ElementTree as ET

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import (
    ConflictException,
    ResourceNotFoundException,
    ValidationException,
)
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreArtifact, ScoreRevision, ScoreRevisionMetadata, User
from app.db.models.score import ArtifactKind, MetadataStatus
from app.modules.revisions.schemas import (
    FingeringRequest,
    FingeringResultRead,
    RevisionContentRead,
    RevisionCreateRequest,
    RevisionRead,
)
from app.modules.revisions.fingering_service import XMLFingeringService
from app.modules.notifications.service import NotificationService
from app.modules.realtime.publisher import RealtimeEventTypes, publish_score_event_best_effort
from app.modules.revisions.derivatives import revision_derivative_service
from app.modules.score_access.policy import ScoreAccessPolicy, ScoreAction
from app.modules.scores.repository import ScoreRepository
from app.shared.constants import ErrorCode
from app.storage import FileStorage, file_storage
from app.utils.timezone import utc_now_naive


class RevisionService:
    def __init__(
        self,
        repository: ScoreRepository | None = None,
        storage: FileStorage | None = None,
        access_policy: ScoreAccessPolicy | None = None,
        fingering_service: XMLFingeringService | None = None,
        notification_service: NotificationService | None = None,
    ) -> None:
        self.repository = repository or ScoreRepository()
        self.storage = storage or file_storage
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.fingering_service = fingering_service or XMLFingeringService()
        self.notification_service = notification_service or NotificationService()

    async def generate_fingering(
        self,
        db: AsyncSession,
        score_uuid: str,
        user_id: int,
        request: FingeringRequest,
    ) -> FingeringResultRead:
        await self.access_policy.authorize(
            db, score_uuid, ScoreAction.EDIT, user_id=user_id
        )
        self._validate_musicxml(request.content.encode("utf-8"))
        generated = self.fingering_service.generate(
            score_uuid,
            request.content,
            hand_size=request.hand_size,
        )
        self._validate_musicxml(generated["xml_content"].encode("utf-8"))
        return FingeringResultRead(content=generated["xml_content"])

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
        self._validate_musicxml(content)
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

        revision_uuid = str(uuid.uuid4())
        key = f"scores/{score_uuid}/revisions/{revision_uuid}/score.musicxml"
        stored = self.storage.put_bytes(
            key=key,
            content=content,
            content_type="application/vnd.recordare.musicxml+xml",
        )
        try:
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
                ScoreArtifact(
                    artifact_uuid=str(uuid.uuid4()),
                    revision_id=revision_id,
                    kind=ArtifactKind.MUSICXML,
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
                payload={
                    "score_id": score.score_uuid,
                    "revision_id": revision.revision_uuid,
                    "revision_number": revision.revision_number,
                    "origin": revision.origin.value,
                },
            )
            await revision_derivative_service.rebuild_metadata_best_effort(
                db,
                score_uuid=score_uuid,
                revision_uuid=revision_uuid,
                user_id=user_id,
                storage=self.storage,
            )
            return await self._read(db, revision)
        except Exception:
            await db.rollback()
            try:
                self.storage.delete(stored.storage_key)
            except Exception:
                pass
            raise

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
        artifact = await self.repository.canonical_artifact(
            db, require_persisted_id(revision.id, entity="score revision")
        )
        if not artifact:
            raise ResourceNotFoundException("artifact", revision_uuid, ErrorCode.FILE_NOT_FOUND)
        content = self.storage.read_bytes(artifact.storage_key).decode("utf-8")
        base = await self._read(db, revision)
        return RevisionContentRead(**base.model_dump(), content=content, mime_type=artifact.mime_type)

    async def _read(self, db: AsyncSession, revision: ScoreRevision) -> RevisionRead:
        parent = await db.get(ScoreRevision, revision.parent_revision_id) if revision.parent_revision_id else None
        base = await db.get(ScoreRevision, revision.base_revision_id) if revision.base_revision_id else None
        return RevisionRead(
            revision_id=revision.revision_uuid,
            revision_number=revision.revision_number,
            parent_revision_id=parent.revision_uuid if parent else None,
            base_revision_id=base.revision_uuid if base else None,
            content_hash=revision.content_hash,
            origin=revision.origin,
            created_at=revision.created_at,
        )

    @staticmethod
    def _validate_musicxml(content: bytes) -> None:
        try:
            root = ET.fromstring(content)
        except ET.ParseError as exc:
            raise ValidationException(ErrorCode.REVISION_CONTENT_INVALID) from exc
        if root.tag.split("}")[-1] not in {"score-partwise", "score-timewise"}:
            raise ValidationException(ErrorCode.REVISION_CONTENT_INVALID)
