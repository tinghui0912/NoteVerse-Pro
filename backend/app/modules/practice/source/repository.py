from __future__ import annotations

import asyncio
import json
from datetime import timedelta
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ValidationException
from app.db.model_utils import require_persisted_id
from app.db.models.practice_source_snapshot import (
    PracticeSourceSnapshot,
    PracticeSourceSnapshotStatus,
)
from app.shared.constants import ErrorCode
from app.storage.base import FileStorage
from app.utils.timezone import utc_now_naive
from app.processing.practice_score.practice_score_artifact import canonical_practice_artifact_bytes
from .domain import (
    PracticeSourceArtifact,
    PracticeSourceBundle,
    PracticeSourceRepresentation,
    PracticeSourceSnapshotRef,
)
from .schemas import PracticeScoreArtifactRead
from .retention import practice_source_snapshot_delete_service

SOURCE_SNAPSHOT_CREATION_LEASE_SECONDS = 15 * 60


class PracticeSourceRepository:
    def __init__(self, storage: FileStorage):
        self.storage = storage

    @staticmethod
    def _reference(snapshot: PracticeSourceSnapshot) -> PracticeSourceSnapshotRef:
        return PracticeSourceSnapshotRef(
            require_persisted_id(snapshot.id, entity="source snapshot"),
            snapshot.source_fingerprint,
            snapshot.source_score_uuid,
            snapshot.source_revision_uuid,
            snapshot.artifact_id,
        )

    async def materialize(
        self, db: AsyncSession, bundle: PracticeSourceBundle
    ) -> PracticeSourceSnapshotRef:
        fingerprint = bundle.source_id
        musicxml_bytes, artifact_bytes = (
            bundle.prepared_musicxml.data,
            bundle.artifact.representation.data,
        )
        musicxml_sha, artifact_sha = (
            bundle.prepared_musicxml.sha256,
            bundle.artifact.representation.sha256,
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
            await self.read_bundle(db, existing.id)
            return self._reference(existing)

        musicxml_key = f"practice-source-snapshots/{fingerprint}/score.musicxml"
        artifact_key = f"practice-source-snapshots/{fingerprint}/artifact.json"
        snapshot = PracticeSourceSnapshot(
            source_fingerprint=fingerprint,
            source_score_uuid=bundle.score_id,
            source_revision_uuid=bundle.revision_id,
            artifact_id=bundle.artifact.artifact_id,
            artifact_schema_version=bundle.artifact.schema_version,
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
                await self.read_bundle(db, existing.id)
                return self._reference(existing)
            raise
        await db.commit()
        await db.refresh(snapshot)

        try:
            await asyncio.to_thread(
                self.storage.put_bytes,
                key=musicxml_key,
                content=musicxml_bytes,
                content_type=bundle.prepared_musicxml.mime_type,
            )
            await asyncio.to_thread(
                self.storage.put_bytes,
                key=artifact_key,
                content=artifact_bytes,
                content_type="application/json",
            )
            for key, expected in [(musicxml_key, musicxml_bytes), (artifact_key, artifact_bytes)]:
                if await asyncio.to_thread(self.storage.read_bytes, key) != expected:
                    raise ValueError("Practice source storage read-back mismatch")
        except Exception as error:
            await self.enqueue_if_unreferenced(db, snapshot.id)
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
                await practice_source_snapshot_delete_service.enqueue_if_unreferenced_async(
                    db, locked_snapshot.id, storage_backend=self.storage.backend_name
                )
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
        await self.read_bundle(db, snapshot.id)
        return self._reference(snapshot)

    async def find_ready(
        self, db: AsyncSession, snapshot_id: int | None, *, lock: bool = False
    ) -> PracticeSourceSnapshotRef | None:
        if snapshot_id is None:
            return None
        stmt = select(PracticeSourceSnapshot).where(PracticeSourceSnapshot.id == snapshot_id)
        if lock:
            stmt = stmt.with_for_update()
        row = (await db.execute(stmt)).scalar_one_or_none()
        return (
            self._reference(row)
            if row and row.status == PracticeSourceSnapshotStatus.READY.value
            else None
        )

    async def require_ready(
        self, db: AsyncSession, snapshot_id: int | None, *, lock: bool = False
    ) -> PracticeSourceSnapshotRef:
        ref = await self.find_ready(db, snapshot_id, lock=lock)
        if ref is None:
            raise ValidationException(
                ErrorCode.STORAGE_BACKEND_UNAVAILABLE if lock else ErrorCode.VALIDATION_ERROR,
                field="source_snapshot" if lock else "source_snapshot_id",
                details={"reason": "source_snapshot_not_ready"},
            )
        return ref

    async def list_ready(
        self, db: AsyncSession, ids: set[int]
    ) -> dict[int, PracticeSourceSnapshotRef]:
        if not ids:
            return {}
        rows = (
            (
                await db.execute(
                    select(PracticeSourceSnapshot).where(
                        PracticeSourceSnapshot.id.in_(ids),
                        PracticeSourceSnapshot.status == PracticeSourceSnapshotStatus.READY.value,
                    )
                )
            )
            .scalars()
            .all()
        )
        return {ref.id: ref for row in rows for ref in [self._reference(row)]}

    async def enqueue_if_unreferenced(self, db: AsyncSession, snapshot_id: int | None) -> None:
        await practice_source_snapshot_delete_service.enqueue_if_unreferenced_async(
            db, snapshot_id, storage_backend=self.storage.backend_name
        )

    async def read_bundle(self, db: AsyncSession, snapshot_id: int | None) -> PracticeSourceBundle:
        await self.require_ready(db, snapshot_id)
        row = await db.get(PracticeSourceSnapshot, snapshot_id)
        assert row is not None
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
                    ErrorCode.VALIDATION_ERROR, field="source_snapshot", details={"reason": reason}
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
                field="source_snapshot",
                details={"reason": "artifact_identity_mismatch"},
            )
        bundle = PracticeSourceBundle(
            row.source_score_uuid,
            row.source_revision_uuid,
            xml,
            PracticeSourceArtifact(data, artifact.artifactId, artifact.schemaVersion),
        )
        if bundle.source_id != row.source_fingerprint:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="source_snapshot",
                details={"reason": "source_identity_mismatch"},
            )
        return bundle
