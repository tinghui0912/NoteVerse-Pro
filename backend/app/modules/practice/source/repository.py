from __future__ import annotations

import asyncio
import json
from dataclasses import dataclass
from datetime import timedelta
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ValidationException
from app.db.model_utils import require_persisted_id
from app.db.models import Score, ScoreRevision
from app.db.models.practice_source import (
    PracticeSourceRecord,
    PracticeSourceStatus,
)
from app.shared.constants import ErrorCode
from app.storage.base import FileStorage
from app.utils.timezone import utc_now_naive
from app.modules.practice.score.artifact import canonical_practice_artifact_bytes
from .domain import (
    PracticeSourceArtifact,
    PracticeSource,
    PracticeSourceRepresentation,
    PracticeSourceRef,
)
from .schemas import PracticeScoreArtifactRead
from .retention import practice_source_delete_service

SOURCE_CREATION_LEASE_SECONDS = 15 * 60


@dataclass(frozen=True)
class PracticeSourceResolution:
    source_ref: PracticeSourceRef
    live_revision_id: int | None


class PracticeSourceRepository:
    def __init__(self, storage: FileStorage):
        self.storage = storage

    @staticmethod
    def _reference(source: PracticeSourceRecord) -> PracticeSourceRef:
        return PracticeSourceRef(
            require_persisted_id(source.id, entity="practice source"),
            source.source_id,
            source.source_score_uuid,
            source.source_revision_uuid,
            source.artifact_id,
        )

    async def get_or_create(
        self,
        db: AsyncSession,
        source: PracticeSource,
        *,
        live_revision_id: int,
    ) -> tuple[PracticeSourceRef, PracticeSource]:
        await self._lock_revision(db, live_revision_id, source.score_id, source.revision_id)
        source_id = source.source_id
        existing_id = await self._id_for_source_id(db, source_id)
        if existing_id is not None:
            return await self._reuse_ready(db, existing_id, source, live_revision_id)
        musicxml_key = f"practice-sources/{source_id}/score.musicxml"
        artifact_key = f"practice-sources/{source_id}/artifact.json"
        row = PracticeSourceRecord(
            source_id=source_id,
            live_revision_id=live_revision_id,
            source_score_uuid=source.score_id,
            source_revision_uuid=source.revision_id,
            artifact_id=source.artifact.artifact_id,
            artifact_schema_version=source.artifact.schema_version,
            prepared_musicxml_object_key=musicxml_key,
            prepared_musicxml_sha256=source.prepared_musicxml.sha256,
            prepared_musicxml_byte_size=source.prepared_musicxml.byte_size,
            artifact_object_key=artifact_key,
            artifact_sha256=source.artifact.representation.sha256,
            artifact_byte_size=source.artifact.representation.byte_size,
            status=PracticeSourceStatus.CREATING.value,
            creation_expires_at=utc_now_naive() + timedelta(seconds=SOURCE_CREATION_LEASE_SECONDS),
        )
        try:
            async with db.begin_nested():
                db.add(row)
                await db.flush()
        except IntegrityError:
            existing_id = await self._id_for_source_id(db, source_id)
            if existing_id is not None:
                return await self._reuse_ready(db, existing_id, source, live_revision_id)
            raise
        await db.commit()
        row_id = require_persisted_id(row.id, entity="practice source")
        try:
            for key, representation in [
                (musicxml_key, source.prepared_musicxml),
                (artifact_key, source.artifact.representation),
            ]:
                await asyncio.to_thread(
                    self.storage.put_bytes,
                    key=key,
                    content=representation.data,
                    content_type=representation.mime_type,
                )
                if await asyncio.to_thread(self.storage.read_bytes, key) != representation.data:
                    raise ValueError("Practice source storage read-back mismatch")
        except Exception as error:
            await self._discard_creation(db, row_id)
            raise ValidationException(
                ErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                field="practice_source",
                details={"reason": "practice_source_storage_write_failed"},
            ) from error
        locked = (
            await db.execute(
                select(PracticeSourceRecord)
                .where(
                    PracticeSourceRecord.id == row_id,
                    PracticeSourceRecord.status == PracticeSourceStatus.CREATING.value,
                    PracticeSourceRecord.creation_expires_at.is_not(None),
                    PracticeSourceRecord.creation_expires_at > utc_now_naive(),
                )
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if locked is None:
            await self._discard_creation(db, row_id)
            raise ValidationException(
                ErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                field="practice_source",
                details={"reason": "practice_source_creation_lease_expired"},
            )
        locked.status, locked.creation_expires_at = PracticeSourceStatus.READY.value, None
        await db.commit()
        return await self._reuse_ready(db, row_id, source, live_revision_id)

    async def _discard_creation(self, db: AsyncSession, practice_source_id: int) -> None:
        await db.run_sync(
            lambda sync_db: practice_source_delete_service.discard_creation(
                sync_db, practice_source_id, storage_backend=self.storage.backend_name
            )
        )
        await db.commit()

    @staticmethod
    async def _lock_revision(
        db: AsyncSession, revision_id: int, score_uuid: str, revision_uuid: str
    ) -> None:
        eligible = (
            await db.execute(
                select(ScoreRevision.id)
                .join(Score, Score.id == ScoreRevision.score_id)
                .where(
                    ScoreRevision.id == revision_id,
                    ScoreRevision.revision_uuid == revision_uuid,
                    Score.score_uuid == score_uuid,
                )
                .with_for_update(read=True, key_share=True)
            )
        ).scalar_one_or_none()
        if eligible is None:
            raise ValidationException(ErrorCode.REVISION_NOT_FOUND, field="revision_id")

    async def _id_for_source_id(self, db: AsyncSession, source_id: str) -> int | None:
        return (
            await db.execute(
                select(PracticeSourceRecord.id).where(PracticeSourceRecord.source_id == source_id)
            )
        ).scalar_one_or_none()

    async def _reuse_ready(
        self,
        db: AsyncSession,
        practice_source_id: int,
        source: PracticeSource,
        live_revision_id: int,
    ) -> tuple[PracticeSourceRef, PracticeSource]:
        await self._lock_revision(db, live_revision_id, source.score_id, source.revision_id)
        row = await self._require_ready_row(db, practice_source_id, lock=True)
        verified = await self._read_verified_source(row)
        row.live_revision_id = live_revision_id
        await db.flush()
        reference = self._reference(row)
        await db.commit()
        return reference, verified

    async def _ready_row(
        self, db: AsyncSession, practice_source_id: int | None, *, lock: bool = False
    ) -> PracticeSourceRecord | None:
        if practice_source_id is None:
            return None
        stmt = (
            select(PracticeSourceRecord)
            .where(
                PracticeSourceRecord.id == practice_source_id,
                PracticeSourceRecord.status == PracticeSourceStatus.READY.value,
            )
            .execution_options(populate_existing=True)
        )
        if lock:
            stmt = stmt.with_for_update()
        return (await db.execute(stmt)).scalar_one_or_none()

    async def _require_ready_row(
        self, db: AsyncSession, practice_source_id: int | None, *, lock: bool = False
    ) -> PracticeSourceRecord:
        row = await self._ready_row(db, practice_source_id, lock=lock)
        if row is None:
            raise ValidationException(
                ErrorCode.STORAGE_BACKEND_UNAVAILABLE if lock else ErrorCode.VALIDATION_ERROR,
                field="practice_source" if lock else "practice_source_id",
                details={"reason": "practice_source_not_ready"},
            )
        return row

    async def find_ready(
        self, db: AsyncSession, practice_source_id: int | None, *, lock: bool = False
    ) -> PracticeSourceRef | None:
        row = await self._ready_row(db, practice_source_id, lock=lock)
        return self._reference(row) if row is not None else None

    async def require_ready(
        self, db: AsyncSession, practice_source_id: int | None, *, lock: bool = False
    ) -> PracticeSourceRef:
        return self._reference(await self._require_ready_row(db, practice_source_id, lock=lock))

    async def list_ready(self, db: AsyncSession, ids: set[int]) -> dict[int, PracticeSourceRef]:
        if not ids:
            return {}
        rows = (
            (
                await db.execute(
                    select(PracticeSourceRecord)
                    .where(
                        PracticeSourceRecord.id.in_(ids),
                        PracticeSourceRecord.status == PracticeSourceStatus.READY.value,
                    )
                    .execution_options(populate_existing=True)
                )
            )
            .scalars()
            .all()
        )
        return {ref.id: ref for row in rows for ref in [self._reference(row)]}

    async def _ready_row_by_source_id(
        self, db: AsyncSession, source_id: str, *, lock: bool
    ) -> PracticeSourceRecord:
        statement = (
            select(PracticeSourceRecord)
            .where(
                PracticeSourceRecord.source_id == source_id,
                PracticeSourceRecord.status == PracticeSourceStatus.READY.value,
            )
            .execution_options(populate_existing=True)
        )
        if lock:
            statement = statement.with_for_update()
        row = (await db.execute(statement)).scalar_one_or_none()
        if row is None:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="source_id",
                details={"reason": "practice_source_not_ready"},
            )
        return row

    async def require_ready_by_source_id(
        self, db: AsyncSession, source_id: str, *, lock: bool = False
    ) -> PracticeSourceResolution:
        row = await self._ready_row_by_source_id(db, source_id, lock=lock)
        return PracticeSourceResolution(self._reference(row), row.live_revision_id)

    async def read_by_source_id(self, db: AsyncSession, source_id: str) -> PracticeSource:
        row = await self._ready_row_by_source_id(db, source_id, lock=True)
        return await self._read_verified_source(row)

    async def enqueue_if_unowned(self, db: AsyncSession, practice_source_id: int | None) -> None:
        await practice_source_delete_service.enqueue_if_unowned_async(
            db, practice_source_id, storage_backend=self.storage.backend_name
        )

    async def read(self, db: AsyncSession, practice_source_id: int | None) -> PracticeSource:
        row = await self._require_ready_row(db, practice_source_id, lock=True)
        return await self._read_verified_source(row)

    async def _read_verified_source(self, row: PracticeSourceRecord) -> PracticeSource:
        xml = PracticeSourceRepresentation(
            await asyncio.to_thread(self.storage.read_bytes, row.prepared_musicxml_object_key),
            "application/vnd.recordare.musicxml+xml",
        )
        data = PracticeSourceRepresentation(
            await asyncio.to_thread(self.storage.read_bytes, row.artifact_object_key),
            "application/json",
        )
        for representation, expected_sha, expected_size, reason in [
            (
                xml,
                row.prepared_musicxml_sha256,
                row.prepared_musicxml_byte_size,
                "prepared_musicxml_checksum_mismatch",
            ),
            (data, row.artifact_sha256, row.artifact_byte_size, "artifact_checksum_mismatch"),
        ]:
            if representation.sha256 != expected_sha or representation.byte_size != expected_size:
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR, field="practice_source", details={"reason": reason}
                )
        artifact = PracticeScoreArtifactRead.model_validate_json(data.data)
        if (
            artifact.scoreId != row.source_score_uuid
            or artifact.revisionId != row.source_revision_uuid
            or artifact.artifactId != row.artifact_id
            or artifact.schemaVersion != row.artifact_schema_version
            or canonical_practice_artifact_bytes(json.loads(data.data)) != data.data
        ):
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="practice_source",
                details={"reason": "artifact_identity_mismatch"},
            )
        source = PracticeSource(
            row.source_score_uuid,
            row.source_revision_uuid,
            xml,
            PracticeSourceArtifact(data, artifact.artifactId, artifact.schemaVersion),
        )
        if source.source_id != row.source_id:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="practice_source",
                details={"reason": "source_identity_mismatch"},
            )
        return source
