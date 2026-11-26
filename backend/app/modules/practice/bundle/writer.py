"""Creation leases, representation writes and atomic Practice revision binding."""

from app.modules.media_storage.write_coordinator import ObjectWriteCoordinator

from .object_keys import practice_bundle_musicxml_object_key, practice_bundle_artifact_object_key

from collections.abc import Callable
from datetime import timedelta

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.core.exceptions import ValidationException
from app.db.model_utils import require_persisted_id
from app.db.models.practice_bundle import PracticeBundleRecord
from app.modules.practice.bundle.states import PracticeBundleStatus

from app.modules.media_storage.adoption import adopt_written_objects
from app.modules.media_storage.write_contracts import ObjectWriteItem
from app.modules.media_storage.write_contracts import ObjectWriteReceipt
from app.shared.error_codes import CustomerErrorCode
from app.shared.time import utc_now
from .content import read_verified_bundle
from .domain import PracticeBundle, PracticeBundleRef
from .repository import PracticeBundleRepository
from .retention import PracticeBundleRetention, practice_bundle_retention

BUNDLE_CREATION_LEASE_SECONDS = 15 * 60


class PracticeBundleWriter:
    def __init__(
        self,
        *,
        repository: PracticeBundleRepository | None = None,
        retention: PracticeBundleRetention | None = None,
        writes: ObjectWriteCoordinator,
    ) -> None:
        self.writes = writes
        self.storage = writes.storage
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
        if row.status == PracticeBundleStatus.CREATING:
            creation_id = require_persisted_id(row.id, entity="practice bundle")
            # A durable null-FK lease must exist before physical IO, so a crash
            # leaves semantic recovery and independent ObjectWriteIntent evidence.
            db.commit()
            receipts = self._prewrite_representations(candidate)
            # Creation admission commits before IO. Reestablish live authorization
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

    def _prewrite_representations(self, candidate: PracticeBundle) -> list[ObjectWriteReceipt]:
        representations = (
            (practice_bundle_musicxml_object_key(candidate.bundle_id), candidate.prepared_musicxml),
            (
                practice_bundle_artifact_object_key(candidate.bundle_id),
                candidate.artifact.representation,
            ),
        )
        try:
            receipts = self.writes.write_batch(
                tuple(
                    ObjectWriteItem(key, value.data, value.mime_type)
                    for key, value in representations
                )
            )
            for receipt, (_, representation) in zip(receipts, representations, strict=True):
                if self.storage.read_bytes(receipt.object_key) != representation.data:
                    raise ValueError("Practice bundle storage read-back mismatch")
            return list(receipts)
        except Exception as error:
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
        if row.status == PracticeBundleStatus.CREATING:
            if row.creation_expires_at is None or row.creation_expires_at <= utc_now():
                raise ValueError("Bundle creation lease expired")
            prepared, artifact = adopt_written_objects(db, receipts)
            row.prepared_musicxml_object, row.artifact_object = prepared, artifact
            row.status, row.creation_expires_at = PracticeBundleStatus.READY, None
            db.flush()
        if row.status != PracticeBundleStatus.READY:
            raise ValidationException(
                CustomerErrorCode.STORAGE_BACKEND_UNAVAILABLE,
                field="practice_bundle",
                details={"reason": "practice_bundle_not_ready"},
            )
        return row
