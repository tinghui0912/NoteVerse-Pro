"""PracticeBundle retention owns semantic GC; physical retirement is shared."""

from sqlalchemy import select
from app.core.config import settings
from app.db.models import PracticeBundleRecord, ScoreRevisionPracticeBinding
from app.modules.storage_objects.retirement import retire_after_release
from app.utils.timezone import utc_now_naive


class PracticeBundleRetention:
    @staticmethod
    def has_owner(db, bundle):
        return (
            db.scalar(
                select(ScoreRevisionPracticeBinding.revision_id)
                .where(ScoreRevisionPracticeBinding.bundle_id == bundle.id)
                .limit(1)
            )
            is not None
        )

    def _retire(self, db, bundle):
        if self.has_owner(db, bundle):
            return []
        ids = (bundle.prepared_musicxml_object_id, bundle.artifact_object_id)
        db.delete(bundle)
        return retire_after_release(db, *(identity for identity in ids if identity is not None))

    def retire_unowned(self, db, bundle_id):
        row = db.execute(
            select(PracticeBundleRecord)
            .where(PracticeBundleRecord.id == bundle_id, PracticeBundleRecord.status == "READY")
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        return self._retire(db, row) if row is not None else []

    def discard_creation(self, db, bundle_id):
        row = db.execute(
            select(PracticeBundleRecord)
            .where(PracticeBundleRecord.id == bundle_id, PracticeBundleRecord.status == "CREATING")
            .with_for_update()
            .execution_options(populate_existing=True)
        ).scalar_one_or_none()
        return self._retire(db, row) if row is not None else []

    def recover_stale_creating(self, db):
        rows = list(
            db.scalars(
                select(PracticeBundleRecord)
                .where(
                    PracticeBundleRecord.status == "CREATING",
                    PracticeBundleRecord.creation_expires_at <= utc_now_naive(),
                )
                .order_by(PracticeBundleRecord.id)
                .limit(settings.PRACTICE_BUNDLE_GC_BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )
        )
        return [uuid for row in rows for uuid in self._retire(db, row)]

    def collect_unowned_ready(self, db):
        rows = list(
            db.scalars(
                select(PracticeBundleRecord)
                .where(
                    PracticeBundleRecord.status == "READY",
                    ~select(ScoreRevisionPracticeBinding.revision_id)
                    .where(ScoreRevisionPracticeBinding.bundle_id == PracticeBundleRecord.id)
                    .exists(),
                )
                .order_by(PracticeBundleRecord.id)
                .limit(settings.PRACTICE_BUNDLE_GC_BATCH_SIZE)
                .with_for_update(skip_locked=True)
            )
        )
        return [uuid for row in rows for uuid in self._retire(db, row)]


practice_bundle_retention = PracticeBundleRetention()
