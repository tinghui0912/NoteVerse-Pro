"""Creation leases, representation writes and atomic Practice revision binding."""

from collections.abc import Callable
from datetime import timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ValidationException
from app.db.model_utils import require_persisted_id
from app.db.models.practice_bundle import PracticeBundleRecord, PracticeBundleStatus
from app.modules.storage_objects.writes import (
    write_object,
    adopt_written_object,
    ObjectWriteReceipt,
)
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now
from app.storage import ObjectStorage
from .content import read_verified_bundle
from .domain import PracticeBundle, PracticeBundleRef
from .repository import PracticeBundleRepository
from .retention import PracticeBundleRetention, practice_bundle_retention

BUNDLE_CREATION_LEASE_SECONDS = 15 * 60


class PracticeBundleWriter:
    def __init__(
        self,
        storage: ObjectStorage,
        *,
        repository: PracticeBundleRepository | None = None,
        retention: PracticeBundleRetention | None = None,
    ):
        self.storage = storage
        self.repository = repository or PracticeBundleRepository()
        self.retention = retention or practice_bundle_retention

    def ensure_binding(
        self,
        db: Session,
        candidate: PracticeBundle,
        *,
        revision_id: int,
        reauthorize_mutation: Callable[[], None],
    ) -> tuple[PracticeBundleRef, PracticeBundle]:
        # The caller holds live mutation access before the first binding lookup.
        bound = self.repository.read_bound_for_update(db, revision_id)
        if bound is not None:
            return self.repository.reference(bound), read_verified_bundle(self.storage, bound)
        row = self._reserve_creation(db, candidate)
        if row.status == PracticeBundleStatus.CREATING.value:
            creation_id = require_persisted_id(row.id, entity="practice bundle")
            # A durable null-FK lease must exist before physical IO, so a crash
            # leaves semantic recovery and independent ObjectWriteIntent evidence.
            db.commit()
            receipts = self._prewrite_representations(db, candidate, creation_id)
            # Prewrite commits release access locks. Reestablish live authorization
            # before inspecting bindings or adopting any physical representation.
            reauthorize_mutation()
            bound = self.repository.read_bound_for_update(db, revision_id)
            if bound is not None:
                return self.repository.reference(bound), read_verified_bundle(self.storage, bound)
            row = self._adopt_ready_bundle(db, creation_id, receipts)
        verified = read_verified_bundle(self.storage, row)
        self.repository.add_binding(
            db,
            revision_id=revision_id,
            bundle_row_id=require_persisted_id(row.id, entity="practice bundle"),
        )
        reference = self.repository.reference(row)
        # Binding and GC serialize on this bundle row until admission commits.
        db.commit()
        return reference, verified

    def _reserve_creation(self, db: Session, candidate: PracticeBundle) -> PracticeBundleRecord:
        row = self.repository.lock_by_bundle_id(db, candidate.bundle_id)
        if row is not None:
            return row
        try:
            with db.begin_nested():
                return self.repository.insert_creation(
                    db,
                    bundle_id=candidate.bundle_id,
                    artifact_id=candidate.artifact.artifact_id,
                    artifact_schema_version=candidate.artifact.schema_version,
                    expires_at=utc_now() + timedelta(seconds=BUNDLE_CREATION_LEASE_SECONDS),
                )
        except IntegrityError:
            row = self.repository.lock_by_bundle_id(db, candidate.bundle_id)
            if row is None:
                raise
            return row

    def _prewrite_representations(
        self, db: Session, candidate: PracticeBundle, creation_id: int
    ) -> list[ObjectWriteReceipt]:
        receipts = []
        try:
            for suffix, representation in [
                ("score.musicxml", candidate.prepared_musicxml),
                ("artifact.json", candidate.artifact.representation),
            ]:
                receipt = write_object(
                    db,
                    self.storage,
                    key=f"practice-bundles/{candidate.bundle_id}/{suffix}",
                    content=representation.data,
                    content_type=representation.mime_type,
                )
                if self.storage.read_bytes(receipt.object_key) != representation.data:
                    raise ValueError("Practice bundle storage read-back mismatch")
                receipts.append(receipt)
            return receipts
        except Exception as error:
            db.rollback()
            self.retention.discard_creation(db, creation_id)
            db.commit()
            raise ValidationException(
                CustomerErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                field="practice_bundle",
                details={"reason": "practice_bundle_storage_write_failed"},
            ) from error

    def _adopt_ready_bundle(
        self, db: Session, creation_id: int, receipts: list[ObjectWriteReceipt]
    ) -> PracticeBundleRecord:
        row = self.repository.lock_by_row_id(db, creation_id)
        if row is None:
            raise ValidationException(
                CustomerErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                field="practice_bundle",
                details={"reason": "creation_lease_lost"},
            )
        if row.status == PracticeBundleStatus.CREATING.value:
            if row.creation_expires_at is None or row.creation_expires_at <= utc_now():
                raise ValueError("Bundle creation lease expired")
            prepared = adopt_written_object(db, receipts[0])
            artifact = adopt_written_object(db, receipts[1])
            row.prepared_musicxml_object, row.artifact_object = prepared, artifact
            row.status, row.creation_expires_at = PracticeBundleStatus.READY.value, None
            db.flush()
        if row.status != PracticeBundleStatus.READY.value:
            raise ValidationException(
                CustomerErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                field="practice_bundle",
                details={"reason": "practice_bundle_not_ready"},
            )
        return row
