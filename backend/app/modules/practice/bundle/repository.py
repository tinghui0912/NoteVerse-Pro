from __future__ import annotations

import asyncio
import json
from datetime import timedelta
from enum import Enum
from collections.abc import Callable, Awaitable
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.storage_objects.persistence import object_from_row
from app.modules.storage_objects.writes import write_object_async, adopt_written_object
from app.core.exceptions import ValidationException, ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreRevisionPracticeBinding, ScoreRevision, Score
from app.db.models.practice_bundle import (
    PracticeBundleRecord,
    PracticeBundleStatus,
)
from app.shared.constants import ErrorCode
from app.storage.base import ObjectStorage
from app.utils.timezone import utc_now_naive
from app.modules.practice.score.artifact import (
    canonical_practice_artifact_bytes,
    practice_artifact_id,
)
from .domain import (
    PracticeBundleArtifact,
    PracticeBundle,
    PracticeBundleRepresentation,
    PracticeBundleRef,
)
from app.modules.practice.score.generated.artifact_transport import PracticeScoreArtifactRead
from app.modules.practice.score.artifact_validation import validate_practice_score_artifact
from .retention import practice_bundle_retention

BUNDLE_CREATION_LEASE_SECONDS = 15 * 60


class BundleRowLock(Enum):
    SHARED_READ = "SHARED_READ"
    MUTATION = "MUTATION"


class PracticeBundleRepository:
    def __init__(self, storage: ObjectStorage):
        self.storage = storage

    @staticmethod
    def _reference(bundle: PracticeBundleRecord) -> PracticeBundleRef:
        return PracticeBundleRef(
            require_persisted_id(bundle.id, entity="practice bundle"),
            bundle.bundle_id,
            bundle.artifact_id,
        )

    async def read_bound(self, db: AsyncSession, revision_id: int):
        """Shared binding/content locks protect verified bytes until the request session ends."""
        return await self._read_bound(db, revision_id, BundleRowLock.SHARED_READ)

    async def read_bound_for_update(self, db: AsyncSession, revision_id: int):
        """Exclusive binding/content locks participate in an admitted Practice mutation."""
        return await self._read_bound(db, revision_id, BundleRowLock.MUTATION)

    async def _read_bound(self, db: AsyncSession, revision_id: int, lock: BundleRowLock):
        statement = (
            select(ScoreRevisionPracticeBinding)
            .where(ScoreRevisionPracticeBinding.revision_id == revision_id)
            .with_for_update(read=lock is BundleRowLock.SHARED_READ)
            .execution_options(populate_existing=True)
        )
        binding = (await db.execute(statement)).scalar_one_or_none()
        if binding is None:
            return None
        row = await self._require_ready_row(db, binding.bundle_id, lock)
        return self._reference(row), await self._read_verified_bundle(row)

    async def _lock_revision(self, db: AsyncSession, revision_id: int):
        score_id = (
            await db.execute(select(ScoreRevision.score_id).where(ScoreRevision.id == revision_id))
        ).scalar_one_or_none()
        score = (
            await db.execute(
                select(Score)
                .where(Score.id == score_id, Score.__table__.c.deleted_at.is_(None))
                .with_for_update()
            )
        ).scalar_one_or_none()
        revision = (
            (
                await db.execute(
                    select(ScoreRevision.id)
                    .where(ScoreRevision.id == revision_id)
                    .with_for_update()
                )
            ).scalar_one_or_none()
            if score is not None
            else None
        )
        if revision is None:
            raise ResourceNotFoundException(
                "revision", str(revision_id), ErrorCode.REVISION_NOT_FOUND
            )

    async def get_or_create(
        self,
        db: AsyncSession,
        bundle: PracticeBundle,
        *,
        revision_id: int,
        reauthorize: Callable[[], Awaitable[object]] | None = None,
    ):
        await self._lock_revision(db, revision_id)
        # Binding uniqueness is database authority.
        bound = await self.read_bound_for_update(db, revision_id)
        if bound is not None:
            return bound
        row = (
            await db.execute(
                select(PracticeBundleRecord)
                .where(PracticeBundleRecord.bundle_id == bundle.bundle_id)
                .with_for_update()
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if row is None:
            created = False
            try:
                async with db.begin_nested():
                    row = PracticeBundleRecord(
                        bundle_id=bundle.bundle_id,
                        artifact_id=bundle.artifact.artifact_id,
                        artifact_schema_version=bundle.artifact.schema_version,
                        status=PracticeBundleStatus.CREATING.value,
                        creation_expires_at=utc_now_naive()
                        + timedelta(seconds=BUNDLE_CREATION_LEASE_SECONDS),
                    )
                    db.add(row)
                    await db.flush()
                created = True
            except IntegrityError:
                row = (
                    await db.execute(
                        select(PracticeBundleRecord)
                        .where(PracticeBundleRecord.bundle_id == bundle.bundle_id)
                        .with_for_update()
                        .execution_options(populate_existing=True)
                    )
                ).scalar_one()
            if created:
                await db.commit()
                if reauthorize is not None:
                    await reauthorize()
                await self._lock_revision(db, revision_id)
                bound = await self.read_bound_for_update(db, revision_id)
                if bound is not None:
                    return bound
                row = (
                    await db.execute(
                        select(PracticeBundleRecord)
                        .where(PracticeBundleRecord.bundle_id == bundle.bundle_id)
                        .with_for_update()
                        .execution_options(populate_existing=True)
                    )
                ).scalar_one()
        if row.status == PracticeBundleStatus.CREATING.value:
            creation_id = row.id
            # Persist the null-FK creation lease before prewriting. Each write owns
            # a committed intent and releases request read/admission locks.
            await db.commit()
            receipts = []
            try:
                for suffix, representation in [
                    ("score.musicxml", bundle.prepared_musicxml),
                    ("artifact.json", bundle.artifact.representation),
                ]:
                    receipt = await write_object_async(
                        db,
                        self.storage,
                        key=f"practice-bundles/{bundle.bundle_id}/{suffix}",
                        content=representation.data,
                        content_type=representation.mime_type,
                    )
                    if (
                        await asyncio.to_thread(self.storage.read_bytes, receipt.object_key)
                        != representation.data
                    ):
                        raise ValueError("Practice bundle storage read-back mismatch")
                    receipts.append(receipt)
            except Exception as error:
                await db.rollback()
                await db.run_sync(
                    lambda sync: practice_bundle_retention.discard_creation(sync, creation_id)
                )
                await db.commit()
                raise ValidationException(
                    ErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                    field="practice_bundle",
                    details={"reason": "practice_bundle_storage_write_failed"},
                ) from error
            if reauthorize is not None:
                await reauthorize()
            await self._lock_revision(db, revision_id)
            bound = await self.read_bound_for_update(db, revision_id)
            if bound is not None:
                return bound
            row = (
                await db.execute(
                    select(PracticeBundleRecord)
                    .where(PracticeBundleRecord.id == creation_id)
                    .with_for_update()
                    .execution_options(populate_existing=True)
                )
            ).scalar_one_or_none()
            if row is None:
                raise ValidationException(
                    ErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                    field="practice_bundle",
                    details={"reason": "creation_lease_lost"},
                )
            if row.status == PracticeBundleStatus.CREATING.value:
                if row.creation_expires_at <= utc_now_naive():
                    raise ValueError("Bundle creation lease expired")
                prepared_object = await db.run_sync(
                    lambda sync: adopt_written_object(sync, receipts[0])
                )
                artifact_object = await db.run_sync(
                    lambda sync: adopt_written_object(sync, receipts[1])
                )
                row.prepared_musicxml_object, row.artifact_object = prepared_object, artifact_object
                row.status, row.creation_expires_at = PracticeBundleStatus.READY.value, None
                await db.flush()
        if row.status != PracticeBundleStatus.READY.value:
            raise ValidationException(
                ErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                field="practice_bundle",
                details={"reason": "practice_bundle_not_ready"},
            )
        verified = await self._read_verified_bundle(row)
        db.add(ScoreRevisionPracticeBinding(revision_id=revision_id, bundle_id=row.id))
        await db.flush()
        reference = self._reference(row)
        await db.commit()
        return reference, verified

    async def _require_ready_row(self, db: AsyncSession, bundle_id: int, lock: BundleRowLock):
        statement = (
            select(PracticeBundleRecord)
            .where(
                PracticeBundleRecord.id == bundle_id,
                PracticeBundleRecord.status == PracticeBundleStatus.READY.value,
            )
            .execution_options(populate_existing=True)
        )
        statement = statement.with_for_update(read=lock is BundleRowLock.SHARED_READ)
        row = (await db.execute(statement)).scalar_one_or_none()
        if row is None:
            raise ResourceNotFoundException(
                "practice_bundle", str(bundle_id), ErrorCode.RESOURCE_NOT_FOUND
            )
        return row

    async def read_by_bundle_id(self, db: AsyncSession, bundle_id: str):
        row = (
            await db.execute(
                select(PracticeBundleRecord)
                .where(
                    PracticeBundleRecord.bundle_id == bundle_id,
                    PracticeBundleRecord.status == PracticeBundleStatus.READY.value,
                )
                .with_for_update(read=True)
                .execution_options(populate_existing=True)
            )
        ).scalar_one_or_none()
        if row is None:
            raise ResourceNotFoundException(
                "practice_bundle", bundle_id, ErrorCode.RESOURCE_NOT_FOUND
            )
        return await self._read_verified_bundle(row)

    async def _read_verified_bundle(self, row: PracticeBundleRecord) -> PracticeBundle:
        if row.prepared_musicxml_object is None or row.artifact_object is None:
            raise ValueError("READY Bundle requires both physical representations")
        xml_facts = object_from_row(row.prepared_musicxml_object)
        artifact_facts = object_from_row(row.artifact_object)
        if (
            xml_facts.content_type != "application/vnd.recordare.musicxml+xml"
            or artifact_facts.content_type != "application/json"
        ):
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="practice_bundle",
                details={"reason": "representation_type_mismatch"},
            )
        xml = PracticeBundleRepresentation(
            await asyncio.to_thread(
                self.storage.read_bytes, row.prepared_musicxml_object.object_key
            ),
            "application/vnd.recordare.musicxml+xml",
        )
        data = PracticeBundleRepresentation(
            await asyncio.to_thread(self.storage.read_bytes, row.artifact_object.object_key),
            "application/json",
        )
        for representation, expected_sha, expected_size, reason in [
            (
                xml,
                row.prepared_musicxml_object.sha256,
                row.prepared_musicxml_object.byte_size,
                "prepared_musicxml_checksum_mismatch",
            ),
            (
                data,
                row.artifact_object.sha256,
                row.artifact_object.byte_size,
                "artifact_checksum_mismatch",
            ),
        ]:
            if representation.sha256 != expected_sha or representation.byte_size != expected_size:
                raise ValidationException(
                    ErrorCode.VALIDATION_ERROR, field="practice_bundle", details={"reason": reason}
                )
        artifact = PracticeScoreArtifactRead.model_validate_json(data.data)
        validate_practice_score_artifact(artifact.model_dump())
        if (
            artifact.artifactId != practice_artifact_id(json.loads(data.data))
            or artifact.artifactId != row.artifact_id
            or artifact.schemaVersion != row.artifact_schema_version
            or canonical_practice_artifact_bytes(json.loads(data.data)) != data.data
        ):
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="practice_bundle",
                details={"reason": "artifact_identity_mismatch"},
            )
        bundle = PracticeBundle(
            xml,
            PracticeBundleArtifact(data, artifact.artifactId, artifact.schemaVersion),
        )
        if bundle.bundle_id != row.bundle_id:
            raise ValidationException(
                ErrorCode.VALIDATION_ERROR,
                field="practice_bundle",
                details={"reason": "bundle_identity_mismatch"},
            )
        return bundle
