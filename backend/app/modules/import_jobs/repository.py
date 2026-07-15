from __future__ import annotations

from datetime import datetime

from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlmodel import col

from app.db.models import (
    ImportArtifact,
    ImportJob,
    ImportJobStep,
    ImportJobUpload,
    Score,
    ScoreInputAsset,
    StorageBlob,
    Upload,
)
job_uuid_col = ImportJob.__table__.c.job_uuid
job_created_col = ImportJob.__table__.c.created_at


class ImportJobRepository:
    async def list_for_user(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        page: int,
        page_size: int,
    ) -> tuple[list[ImportJob], int]:
        total = int(
            (
                await db.execute(
                    select(func.count(ImportJob.id)).where(
                        ImportJob.user_id == user_id
                    )
                )
            ).scalar_one()
        )
        rows = await db.execute(
            select(ImportJob)
            .where(ImportJob.user_id == user_id)
            .order_by(job_created_col.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(rows.scalars().all()), total
    async def get_by_uuid(self, db: AsyncSession, job_uuid: str) -> ImportJob | None:
        result = await db.execute(
            select(ImportJob).where(ImportJob.job_uuid == job_uuid)
        )
        return result.scalars().first()

    async def batch_status(
        self,
        db: AsyncSession,
        job_uuids: list[str],
        user_id: int,
    ) -> list[ImportJob]:
        result = await db.execute(
            select(ImportJob).where(
                ImportJob.user_id == user_id,
                job_uuid_col.in_(job_uuids),
            )
        )
        return list(result.scalars().all())

    async def artifact_by_uuid(
        self, db: AsyncSession, artifact_uuid: str
    ) -> ImportArtifact | None:
        return (
            await db.execute(
                select(ImportArtifact).where(
                    ImportArtifact.artifact_uuid == artifact_uuid
                )
            )
        ).scalar_one_or_none()


class SyncImportJobRepository:
    @staticmethod
    def get_by_uuid(db: Session, job_uuid: str) -> ImportJob | None:
        return db.execute(
            select(ImportJob).where(ImportJob.job_uuid == job_uuid)
        ).scalar_one_or_none()

    @staticmethod
    def get_by_idempotency_key(
        db: Session,
        user_id: int,
        idempotency_key: str,
    ) -> ImportJob | None:
        return db.execute(
            select(ImportJob).where(
                ImportJob.user_id == user_id,
                ImportJob.idempotency_key == idempotency_key,
            )
        ).scalar_one_or_none()

    @staticmethod
    def get_step(db: Session, job_id: int, name: str) -> ImportJobStep | None:
        return db.execute(
            select(ImportJobStep).where(
                ImportJobStep.job_id == job_id,
                ImportJobStep.name == name,
            )
        ).scalar_one_or_none()

    @staticmethod
    def list_steps(db: Session, job_id: int) -> list[ImportJobStep]:
        return list(
            db.execute(
                select(ImportJobStep)
                .where(ImportJobStep.job_id == job_id)
                .order_by(col(ImportJobStep.step_order))
            ).scalars()
        )

    @staticmethod
    def list_artifacts(db: Session, job_id: int) -> list[ImportArtifact]:
        return list(
            db.execute(
                select(ImportArtifact).where(ImportArtifact.job_id == job_id)
            ).scalars()
        )

    @staticmethod
    def delete_artifacts_by_kind(db: Session, job_id: int, kind: str) -> None:
        db.execute(
            delete(ImportArtifact).where(
                ImportArtifact.job_id == job_id,
                ImportArtifact.kind == kind,
            )
        )

    @staticmethod
    def get_upload_by_uuid(db: Session, upload_uuid: str) -> Upload | None:
        return db.execute(
            select(Upload).where(Upload.upload_uuid == upload_uuid)
        ).scalar_one_or_none()

    @staticmethod
    def get_job_upload(
        db: Session,
        job_id: int,
        upload_id: int,
    ) -> ImportJobUpload | None:
        return db.execute(
            select(ImportJobUpload).where(
                ImportJobUpload.job_id == job_id,
                ImportJobUpload.upload_id == upload_id,
            )
        ).scalar_one_or_none()

    @staticmethod
    def list_upload_rows(
        db: Session,
        job_id: int,
    ) -> list[tuple[ImportJobUpload, Upload, StorageBlob]]:
        return [
            (job_upload, upload, blob)
            for job_upload, upload, blob in db.execute(
                select(ImportJobUpload, Upload, StorageBlob)
                .join(Upload, ImportJobUpload.upload_id == Upload.id)
                .join(StorageBlob, Upload.blob_id == StorageBlob.id)
                .where(ImportJobUpload.job_id == job_id)
                .order_by(col(ImportJobUpload.sort_order).asc(), col(ImportJobUpload.id).asc())
            ).all()
        ]

    @staticmethod
    def get_score_uuid(db: Session, score_id: int | None) -> str | None:
        if score_id is None:
            return None
        score = db.get(Score, score_id)
        return score.score_uuid if score else None

    @staticmethod
    def list_orphan_uploads(db: Session, cutoff: datetime) -> list[Upload]:
        job_link_id = ImportJobUpload.__table__.c.id
        input_asset_id = ScoreInputAsset.__table__.c.id
        return list(
            db.execute(
                select(Upload)
                .outerjoin(ImportJobUpload, Upload.id == ImportJobUpload.upload_id)
                .outerjoin(ScoreInputAsset, Upload.id == ScoreInputAsset.upload_id)
                .where(
                    job_link_id.is_(None),
                    input_asset_id.is_(None),
                    Upload.created_at < cutoff,
                )
            ).scalars()
        )
