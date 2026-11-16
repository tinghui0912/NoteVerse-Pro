from __future__ import annotations
from app.modules.storage_objects.reads import StoredObjectReadTarget, read_admitted_bytes
from app.storage import ObjectStorage
from app.modules.storage_objects.writes import write_object

import hashlib
import uuid

from sqlalchemy import select
from sqlalchemy.orm import Session

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
from app.shared.error_codes import CustomerErrorCode
from app.storage import object_storage
from app.shared.time import utc_now


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
        self.access_policy = access_policy or ScoreAccessPolicy()
        self.read_model = read_model or RevisionReadModel()

    def create(
        self, db: Session, score_uuid: str, user_id: int, request: RevisionCreateRequest
    ) -> RevisionRead:
        access = self.access_policy.authorize_score(
            db, score_uuid, ScoreAction.EDIT, user_id=user_id
        )
        content = admit_musicxml_document(request.content.encode("utf-8"))
        return self._append(
            db,
            score_uuid,
            user_id,
            content,
            expected_head_uuid=request.expected_head_revision_id,
            origin=request.origin,
            owner_user_id=access.score.owner_user_id,
            idempotency_key=request.idempotency_key,
        )

    def _append(
        self,
        db: Session,
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
        existing = revision_writer.existing_append(
            db,
            score_uuid=score_uuid,
            expected_head_uuid=expected_head_uuid,
            content_hash=hashlib.sha256(content).hexdigest(),
            idempotency_key=idempotency_key,
        )
        if existing is not None:
            db.commit()
            return self._read(db, existing)
        revision_uuid = str(uuid.uuid4())
        reservation = storage_usage_service.reserve(
            db,
            user_id=owner_user_id,
            category=StorageUsageCategory.SOURCE,
            bytes_count=len(content),
            reason="revision_restore" if restore else "revision_create",
            object_type="score_revision_source",
        )
        committed = False
        try:
            db.commit()
            receipt = write_object(
                db,
                self.storage,
                key=f"scores/{score_uuid}/revisions/{revision_uuid}/score.musicxml",
                content=content,
                content_type="application/vnd.recordare.musicxml+xml",
            )
            self.access_policy.authorize_score(db, score_uuid, ScoreAction.EDIT, user_id=user_id)
            prepared = PreparedRevisionSource(
                revision_uuid,
                receipt,
                hashlib.sha256(content).hexdigest(),
                "restore" if restore else "editor",
                "1",
                reservation.reservation_id,
            )
            result = revision_writer.write(
                db,
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
            db.commit()
            committed = True
            revision_fast_path(result)
            return self._read(db, result.revision)
        except Exception:
            db.rollback()
            if not committed:
                storage_usage_service.release_reservation(db, reservation.reservation_id)
                db.commit()
            raise

    def list(
        self,
        db: Session,
        score_uuid: str,
        user_id: int,
        *,
        limit: int,
        cursor: int | None = None,
    ) -> RevisionListRead:
        access = self.access_policy.authorize_score(
            db, score_uuid, ScoreAction.EDIT, user_id=user_id
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        revisions, next_cursor = self.repository.revisions(db, score_id, limit=limit, cursor=cursor)
        return RevisionListRead(
            items=[self._read(db, revision) for revision in revisions],
            next_cursor=next_cursor,
        )

    def restore(
        self,
        db: Session,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
        request: RevisionRestoreRequest,
    ) -> RevisionRead:
        access = self.access_policy.authorize_revision(
            db, score_uuid, ScoreAction.EDIT, user_id=user_id, revision_uuid=revision_uuid
        )
        target = access.revision
        source = self.asset_repository.canonical_source(
            db, require_persisted_id(target.id, entity="revision")
        )
        if source is None:
            raise ResourceNotFoundException(
                "source", revision_uuid, CustomerErrorCode.FILE_NOT_FOUND
            )
        content = admit_musicxml_document(
            (
                read_admitted_bytes(
                    self.storage, StoredObjectReadTarget.from_object(source.stored_object)
                )
            )
        )
        return self._append(
            db,
            score_uuid,
            user_id,
            content,
            expected_head_uuid=request.expected_head_revision_id,
            origin=RevisionOrigin.EDIT,
            owner_user_id=access.score.owner_user_id,
            restore=RestoreLineage(revision_uuid, request.note),
        )

    def update_note(
        self,
        db: Session,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
        request: RevisionNoteUpdateRequest,
    ) -> RevisionRead:
        access = self.access_policy.authorize_revision(
            db,
            score_uuid,
            ScoreAction.EDIT,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        score_id = require_persisted_id(access.score.id, entity="score")
        revision = access.revision
        revision_id = require_persisted_id(revision.id, entity="score revision")
        note_text = request.note.strip() if request.note else ""
        existing = (
            db.execute(
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
                        created_at=utc_now(),
                        updated_at=utc_now(),
                    )
                )
            else:
                existing.author_user_id = user_id
                existing.note = note_text
                existing.updated_at = utc_now()
        elif existing is not None:
            db.delete(existing)
        db.commit()
        db.refresh(revision)
        return self._read(db, revision)

    def content(
        self, db: Session, score_uuid: str, revision_uuid: str, user_id: int
    ) -> RevisionContentRead:
        access = self.access_policy.authorize_revision(
            db,
            score_uuid,
            ScoreAction.EDIT,
            user_id=user_id,
            revision_uuid=revision_uuid,
        )
        revision = access.revision
        source = self.asset_repository.canonical_source(
            db, require_persisted_id(revision.id, entity="score revision")
        )
        if not source:
            raise ResourceNotFoundException(
                "source", revision_uuid, CustomerErrorCode.FILE_NOT_FOUND
            )
        content = (
            read_admitted_bytes(
                self.storage, StoredObjectReadTarget.from_object(source.stored_object)
            )
        ).decode("utf-8")
        base = self._read(db, revision)
        return RevisionContentRead(
            **base.model_dump(), content=content, mime_type=source.stored_object.content_type
        )

    def _read(self, db: Session, revision: ScoreRevision) -> RevisionRead:
        return self.read_model.revision_read(db, revision)
