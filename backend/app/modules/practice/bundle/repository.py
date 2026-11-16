"""DB-only queries and row locks for bundle records and revision bindings."""

from datetime import datetime
from enum import Enum

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.exceptions import ResourceNotFoundException
from app.db.model_utils import require_persisted_id
from app.db.models import ScoreRevisionPracticeBinding
from app.db.models.practice_bundle import PracticeBundleRecord, PracticeBundleStatus
from app.shared.error_codes import CustomerErrorCode
from .domain import PracticeBundleRef


class BundleRowLock(Enum):
    SHARED_READ = "SHARED_READ"
    MUTATION = "MUTATION"


class PracticeBundleRepository:
    @staticmethod
    def reference(bundle: PracticeBundleRecord) -> PracticeBundleRef:
        return PracticeBundleRef(
            require_persisted_id(bundle.id, entity="practice bundle"),
            bundle.bundle_id,
            bundle.artifact_id,
        )

    def read_bound(self, db: Session, revision_id: int) -> PracticeBundleRecord | None:
        """Shared binding/bundle locks protect reads until the request Session closes."""
        return self._read_bound(db, revision_id, BundleRowLock.SHARED_READ)

    def read_bound_for_update(self, db: Session, revision_id: int) -> PracticeBundleRecord | None:
        return self._read_bound(db, revision_id, BundleRowLock.MUTATION)

    def _read_bound(
        self, db: Session, revision_id: int, lock: BundleRowLock
    ) -> PracticeBundleRecord | None:
        binding = db.scalar(
            select(ScoreRevisionPracticeBinding)
            .where(ScoreRevisionPracticeBinding.revision_id == revision_id)
            .with_for_update(read=lock is BundleRowLock.SHARED_READ)
            .execution_options(populate_existing=True)
        )
        return None if binding is None else self.require_ready_row(db, binding.bundle_id, lock)

    @staticmethod
    def lock_by_bundle_id(db: Session, bundle_id: str) -> PracticeBundleRecord | None:
        return db.scalar(
            select(PracticeBundleRecord)
            .where(PracticeBundleRecord.bundle_id == bundle_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    @staticmethod
    def lock_by_row_id(db: Session, row_id: int) -> PracticeBundleRecord | None:
        return db.scalar(
            select(PracticeBundleRecord)
            .where(PracticeBundleRecord.id == row_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    @staticmethod
    def insert_creation(
        db: Session,
        *,
        bundle_id: str,
        artifact_id: str,
        artifact_schema_version: int,
        expires_at: datetime,
    ) -> PracticeBundleRecord:
        row = PracticeBundleRecord(
            bundle_id=bundle_id,
            artifact_id=artifact_id,
            artifact_schema_version=artifact_schema_version,
            status=PracticeBundleStatus.CREATING.value,
            creation_expires_at=expires_at,
        )
        db.add(row)
        db.flush()
        return row

    @staticmethod
    def add_binding(db: Session, *, revision_id: int, bundle_row_id: int) -> None:
        db.add(ScoreRevisionPracticeBinding(revision_id=revision_id, bundle_id=bundle_row_id))
        db.flush()

    @staticmethod
    def require_ready_row(db: Session, bundle_id: int, lock: BundleRowLock) -> PracticeBundleRecord:
        row = db.scalar(
            select(PracticeBundleRecord)
            .where(
                PracticeBundleRecord.id == bundle_id,
                PracticeBundleRecord.status == PracticeBundleStatus.READY.value,
            )
            .with_for_update(read=lock is BundleRowLock.SHARED_READ)
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise ResourceNotFoundException(
                "practice_bundle", str(bundle_id), CustomerErrorCode.RESOURCE_NOT_FOUND
            )
        return row

    @staticmethod
    def read_by_bundle_id(db: Session, bundle_id: str) -> PracticeBundleRecord:
        row = db.scalar(
            select(PracticeBundleRecord)
            .where(
                PracticeBundleRecord.bundle_id == bundle_id,
                PracticeBundleRecord.status == PracticeBundleStatus.READY.value,
            )
            .with_for_update(read=True)
            .execution_options(populate_existing=True)
        )
        if row is None:
            raise ResourceNotFoundException(
                "practice_bundle", bundle_id, CustomerErrorCode.RESOURCE_NOT_FOUND
            )
        return row
