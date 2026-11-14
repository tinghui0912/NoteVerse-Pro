from __future__ import annotations
from app.modules.storage_objects.retirement import retire_released_objects

from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlalchemy.engine import RowMapping

from .artifact_kinds import ImportArtifactKind

from app.db.models import (
    ExecutionManifest,
    ImportArtifact,
    ImportJob,
    ImportJobStep,
    ImportJobUpload,
    Score,
    ScoreInputAsset,
    StoredObject,
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
                    select(func.count(ImportJob.id)).where(ImportJob.user_id == user_id)
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
        result = await db.execute(select(ImportJob).where(ImportJob.job_uuid == job_uuid))
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

    async def artifact_by_uuid(self, db: AsyncSession, artifact_uuid: str) -> ImportArtifact | None:
        return (
            await db.execute(
                select(ImportArtifact).where(ImportArtifact.artifact_uuid == artifact_uuid)
            )
        ).scalar_one_or_none()

    async def get_by_idempotency_key(
        self, db: AsyncSession, user_id: int, key: str
    ) -> ImportJob | None:
        return (
            await db.execute(
                select(ImportJob).where(
                    ImportJob.user_id == user_id,
                    ImportJob.idempotency_key == key,
                )
            )
        ).scalar_one_or_none()

    async def submission_uploads(self, db: AsyncSession, upload_ids: list[str]) -> list[RowMapping]:
        return list(
            (
                await db.execute(
                    select(Upload.id, Upload.upload_uuid, Upload.uploader_user_id)
                    .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                    .where(Upload.__table__.c.upload_uuid.in_(upload_ids))
                )
            )
            .mappings()
            .all()
        )

    async def score_uuids(self, db: AsyncSession, score_ids: set[int]) -> dict[int, str]:
        if not score_ids:
            return {}
        return dict(
            (
                await db.execute(
                    select(Score.id, Score.score_uuid).where(Score.__table__.c.id.in_(score_ids))
                )
            ).all()
        )

    async def execution_manifest_digests(
        self, db: AsyncSession, manifest_ids: set[int]
    ) -> dict[int, str]:
        if not manifest_ids:
            return {}
        return dict(
            (
                await db.execute(
                    select(ExecutionManifest.id, ExecutionManifest.sha256).where(
                        ExecutionManifest.__table__.c.id.in_(manifest_ids)
                    )
                )
            ).all()
        )

    async def preview_artifacts_for_jobs(
        self, db: AsyncSession, job_ids: list[int]
    ) -> list[RowMapping]:
        return list(
            (
                await db.execute(
                    select(
                        ImportArtifact.job_id,
                        ImportArtifact.artifact_uuid,
                        ImportArtifact.filename,
                        ImportArtifact.page_number,
                        StoredObject.byte_size,
                        StoredObject.content_type,
                    )
                    .join(StoredObject, ImportArtifact.stored_object_id == StoredObject.id)
                    .where(
                        ImportArtifact.__table__.c.job_id.in_(job_ids),
                        ImportArtifact.kind == ImportArtifactKind.REVIEW_PREVIEW_IMAGE.value,
                    )
                    .order_by(ImportArtifact.__table__.c.id.asc())
                )
            )
            .mappings()
            .all()
        )

    async def uploads_for_jobs(self, db: AsyncSession, job_ids: list[int]) -> list[RowMapping]:
        return list(
            (
                await db.execute(
                    select(
                        ImportJobUpload.job_id,
                        ImportJobUpload.page_number,
                        Upload.__table__.c.id.label("upload_row_id"),
                        Upload.upload_uuid,
                        Upload.original_filename,
                        StoredObject.byte_size,
                        StoredObject.content_type,
                    )
                    .join(Upload, ImportJobUpload.upload_id == Upload.id)
                    .join(StoredObject, Upload.stored_object_id == StoredObject.id)
                    .where(ImportJobUpload.__table__.c.job_id.in_(job_ids))
                    .order_by(
                        ImportJobUpload.__table__.c.sort_order.asc(),
                        ImportJobUpload.__table__.c.id.asc(),
                    )
                )
            )
            .mappings()
            .all()
        )


class SyncImportJobRepository:
    @staticmethod
    def get_by_uuid(db: Session, job_uuid: str) -> ImportJob | None:
        return db.execute(
            select(ImportJob).where(ImportJob.job_uuid == job_uuid)
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
    def list_artifacts(db: Session, job_id: int) -> list[ImportArtifact]:
        return list(
            db.execute(select(ImportArtifact).where(ImportArtifact.job_id == job_id)).scalars()
        )

    @staticmethod
    def delete_artifacts_by_kind(db: Session, job_id: int, kind: str) -> None:
        rows = list(
            db.scalars(
                select(ImportArtifact).where(
                    ImportArtifact.job_id == job_id, ImportArtifact.kind == kind
                )
            )
        )
        for row in rows:
            db.delete(row)
            retire_released_objects(db, row.stored_object_id)
        db.flush()

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
