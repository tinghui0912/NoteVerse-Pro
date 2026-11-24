"""Locked Upload projections and set-based reference queries for Score input lifecycle."""

from dataclasses import dataclass
from sqlalchemy import select, delete
from sqlalchemy.orm import Session
from app.db.models import Score, ScoreInputAsset, ImportJob, ImportJobUpload, Upload, StoredObject


@dataclass(frozen=True)
class InputUpload:
    id: int
    upload_uuid: str
    uploader_user_id: int
    object_id: int
    object_key: str
    byte_size: int
    page_number: int | None = None
    sort_order: int = 0


class ScoreInputAssetRepository:
    def lock_score(self, db: Session, score_id: int) -> Score | None:
        return db.scalar(
            select(Score)
            .where(Score.id == score_id)
            .with_for_update()
            .execution_options(populate_existing=True)
        )

    def job_owner(self, db: Session, job_id: int) -> int | None:
        return db.scalar(select(ImportJob.user_id).where(ImportJob.id == job_id))

    def lock_import_uploads(self, db: Session, job_id: int) -> list[InputUpload]:
        return [
            InputUpload(*row)
            for row in db.execute(
                select(
                    Upload.id,
                    Upload.upload_uuid,
                    Upload.uploader_user_id,
                    StoredObject.id,
                    StoredObject.object_key,
                    StoredObject.byte_size,
                    ImportJobUpload.page_number,
                    ImportJobUpload.sort_order,
                )
                .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                .join(ImportJobUpload, ImportJobUpload.upload_id == Upload.id)
                .where(ImportJobUpload.job_id == job_id)
                .order_by(Upload.id)
                .with_for_update(of=Upload)
            )
        ]

    def lock_score_uploads(self, db: Session, score_id: int) -> list[InputUpload]:
        return [
            InputUpload(*row)
            for row in db.execute(
                select(
                    Upload.id,
                    Upload.upload_uuid,
                    Upload.uploader_user_id,
                    StoredObject.id,
                    StoredObject.object_key,
                    StoredObject.byte_size,
                )
                .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                .where(
                    Upload.id.in_(
                        select(ScoreInputAsset.upload_id).where(
                            ScoreInputAsset.score_id == score_id
                        )
                    )
                )
                .order_by(Upload.id)
                .with_for_update(of=Upload)
            )
        ]

    def existing_inputs(self, db: Session, upload_ids: list[int]) -> list[ScoreInputAsset]:
        return list(
            db.scalars(select(ScoreInputAsset).where(ScoreInputAsset.upload_id.in_(upload_ids)))
        )

    def delete_score_inputs(self, db: Session, score_id: int) -> None:
        db.execute(delete(ScoreInputAsset).where(ScoreInputAsset.score_id == score_id))
        db.flush()

    def reference_sets(self, db: Session, upload_ids: list[int]) -> tuple[set[int], set[int]]:
        inputs = set(
            db.scalars(
                select(ScoreInputAsset.upload_id)
                .where(ScoreInputAsset.upload_id.in_(upload_ids))
                .distinct()
            )
        )
        jobs = set(
            db.scalars(
                select(ImportJobUpload.upload_id)
                .where(ImportJobUpload.upload_id.in_(upload_ids))
                .distinct()
            )
        )
        return inputs, jobs

    def delete_uploads(self, db: Session, upload_ids: list[int]) -> None:
        db.execute(delete(Upload).where(Upload.id.in_(upload_ids)))
        db.flush()
