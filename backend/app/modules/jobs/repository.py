from __future__ import annotations

from datetime import datetime

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.db.models import (
    ProcessingArtifact,
    ProcessingJob,
    ProcessingJobStep,
    ProcessingJobUpload,
    Score,
    Upload,
)
from app.db.models.processing_job import ProcessingJobState

job_uuid_col = ProcessingJob.__table__.c.job_uuid
job_created_col = ProcessingJob.__table__.c.created_at


class JobRepository:
    async def list_for_user(
        self,
        db: AsyncSession,
        user_id: int,
        *,
        page: int,
        page_size: int,
    ) -> tuple[list[ProcessingJob], int]:
        total = int(
            (
                await db.execute(
                    select(func.count(ProcessingJob.id)).where(
                        ProcessingJob.user_id == user_id
                    )
                )
            ).scalar_one()
        )
        rows = await db.execute(
            select(ProcessingJob)
            .where(ProcessingJob.user_id == user_id)
            .order_by(job_created_col.desc())
            .offset((page - 1) * page_size)
            .limit(page_size)
        )
        return list(rows.scalars().all()), total
    async def get_by_uuid(self, db: AsyncSession, job_uuid: str) -> ProcessingJob | None:
        result = await db.execute(
            select(ProcessingJob).where(ProcessingJob.job_uuid == job_uuid)
        )
        return result.scalars().first()

    async def batch_status(
        self,
        db: AsyncSession,
        job_uuids: list[str],
        user_id: int,
    ) -> list[ProcessingJob]:
        result = await db.execute(
            select(ProcessingJob).where(
                ProcessingJob.user_id == user_id,
                job_uuid_col.in_(job_uuids),
            )
        )
        return list(result.scalars().all())

    async def artifact_by_uuid(
        self, db: AsyncSession, artifact_uuid: str
    ) -> ProcessingArtifact | None:
        return (
            await db.execute(
                select(ProcessingArtifact).where(
                    ProcessingArtifact.artifact_uuid == artifact_uuid
                )
            )
        ).scalar_one_or_none()


class SyncJobRepository:
    @staticmethod
    def get_by_uuid(db: Session, job_uuid: str) -> ProcessingJob | None:
        return db.query(ProcessingJob).filter_by(job_uuid=job_uuid).first()

    @staticmethod
    def get_by_idempotency_key(
        db: Session,
        user_id: int,
        idempotency_key: str,
    ) -> ProcessingJob | None:
        return (
            db.query(ProcessingJob)
            .filter_by(user_id=user_id, idempotency_key=idempotency_key)
            .first()
        )

    @staticmethod
    def get_step(db: Session, job_id: int, name: str) -> ProcessingJobStep | None:
        return db.query(ProcessingJobStep).filter_by(job_id=job_id, name=name).first()

    @staticmethod
    def list_steps(db: Session, job_id: int) -> list[ProcessingJobStep]:
        return (
            db.query(ProcessingJobStep)
            .filter_by(job_id=job_id)
            .order_by(ProcessingJobStep.step_order)
            .all()
        )

    @staticmethod
    def list_artifacts(db: Session, job_id: int) -> list[ProcessingArtifact]:
        return db.query(ProcessingArtifact).filter_by(job_id=job_id).all()

    @staticmethod
    def delete_artifacts_by_kind(db: Session, job_id: int, kind: str) -> None:
        db.query(ProcessingArtifact).filter_by(job_id=job_id, kind=kind).delete()

    @staticmethod
    def get_upload_by_sha256(db: Session, sha256: str) -> Upload | None:
        return db.query(Upload).filter_by(sha256=sha256).first()

    @staticmethod
    def get_job_upload(
        db: Session,
        job_id: int,
        upload_id: int,
    ) -> ProcessingJobUpload | None:
        return (
            db.query(ProcessingJobUpload)
            .filter_by(job_id=job_id, upload_id=upload_id)
            .first()
        )

    @staticmethod
    def list_upload_rows(
        db: Session,
        job_id: int,
    ) -> list[tuple[ProcessingJobUpload, Upload]]:
        return (
            db.query(ProcessingJobUpload, Upload)
            .join(Upload, ProcessingJobUpload.upload_id == Upload.id)
            .filter(ProcessingJobUpload.job_id == job_id)
            .all()
        )

    @staticmethod
    def get_score_uuid(db: Session, score_id: int | None) -> str | None:
        if score_id is None:
            return None
        score = db.query(Score).filter_by(id=score_id).first()
        return score.score_uuid if score else None

    @staticmethod
    @staticmethod
    def list_stale_pending(db: Session, cutoff: datetime) -> list[ProcessingJob]:
        return (
            db.query(ProcessingJob)
            .filter(ProcessingJob.state == ProcessingJobState.PENDING)
            .filter(ProcessingJob.created_at < cutoff)
            .all()
        )

    @staticmethod
    def list_stale_progress(db: Session, cutoff: datetime) -> list[ProcessingJob]:
        heartbeat = ProcessingJob.__table__.c.last_heartbeat_at
        return (
            db.query(ProcessingJob)
            .filter(ProcessingJob.state == ProcessingJobState.PROGRESS)
            .filter(or_(heartbeat.is_(None), heartbeat < cutoff))
            .all()
        )

    @staticmethod
    def list_orphan_uploads(db: Session, cutoff: datetime) -> list[Upload]:
        job_link_id = ProcessingJobUpload.__table__.c.id
        return (
            db.query(Upload)
            .outerjoin(ProcessingJobUpload, Upload.id == ProcessingJobUpload.upload_id)
            .filter(job_link_id.is_(None))
            .filter(Upload.created_at < cutoff)
            .all()
        )
