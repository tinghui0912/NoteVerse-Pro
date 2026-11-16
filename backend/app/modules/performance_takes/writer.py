"""The transaction participant that admits a verified recording as a durable Take."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models.score import Score
from app.db.models.performance_take import PerformanceTake
from app.modules.storage_objects.persistence import object_to_row
from app.modules.storage_usage.service import StorageUsageService
from app.shared.time import utc_now
from app.core.exceptions import ValidationException
from app.shared.error_codes import CustomerErrorCode
from .final_media import VerifiedPerformanceTakeCandidate
from .manifest import TakeManifest
from .manifest_persistence import manifest_from_row
from .repository import PerformanceTakeRepository
from .upload_reservation.persistence import lifecycle_from_row
from .upload_reservation.effects import apply_reservation_transition


class PerformanceTakeWriter:
    def __init__(
        self, repository: PerformanceTakeRepository, storage_usage_service: StorageUsageService
    ) -> None:
        self.repository = repository
        self.storage_usage_service = storage_usage_service

    def adopt(
        self,
        db: Session,
        *,
        user_id: int,
        reservation_id: str,
        manifest: TakeManifest,
        candidate: VerifiedPerformanceTakeCandidate,
    ) -> PerformanceTake:
        # Refresh under the authoritative row lock; callers cannot supply an unlocked row.
        reservation = self.repository.get_reservation_by_uuid(
            db, user_id, reservation_id, lock=True
        )
        if reservation is None or user_id != manifest.user_id:
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="reservation_id")
        state = lifecycle_from_row(reservation)
        current_lease = state.require_current_lease(
            token=candidate.lease.token, object_key=candidate.lease.object_key, now=utc_now()
        )
        if current_lease != candidate.lease:
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="candidate")
        if manifest_from_row(reservation.manifest) != manifest:
            raise ValidationException(CustomerErrorCode.VALIDATION_ERROR, field="manifest")
        candidate.validate(manifest)
        transition = state.complete(
            token=candidate.lease.token, object_key=candidate.lease.object_key, now=utc_now()
        )
        current_score = (
            (
                db.execute(
                    select(Score)
                    .where(
                        Score.score_uuid == manifest.snapshot.practice_binding.score_id,
                        Score.__table__.c.deleted_at.is_(None),
                    )
                    .with_for_update(read=True, key_share=True)
                )
            )
            .scalars()
            .first()
        )
        blob = object_to_row(candidate.object_facts)
        db.add(blob)
        db.flush()
        take = PerformanceTake(
            recording_object_id=blob.id,
            recording_object=blob,
            manifest_id=reservation.manifest_id,
            manifest=reservation.manifest,
            linked_score_id=current_score.id if current_score is not None else None,
        )
        self.repository.create_take(db, take)
        apply_reservation_transition(
            self.storage_usage_service, db, reservation, transition, now=utc_now()
        )
        db.flush()
        return take
