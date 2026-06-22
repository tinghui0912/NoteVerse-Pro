from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.exceptions import ResourceNotFoundException, UnauthorizedException, ValidationException
from app.db.models import ProcessingJob, User
from app.db.models.processing_job import ProcessingJobState
from app.db.model_utils import require_persisted_id
from app.modules.jobs.repository import JobRepository
from app.modules.jobs.schemas import JobDetail, JobStatusEntry, JobSubmitRequestLike, JobSubmitResult
from app.modules.jobs.submission_service import JobSubmissionService
from app.modules.jobs.worker_service import sync_job_service
from app.shared.constants import ErrorCode


class JobService:
    def __init__(
        self,
        repository: JobRepository | None = None,
        submission_service: JobSubmissionService | None = None,
    ) -> None:
        self.repository = repository or JobRepository()
        self.submission_service = submission_service or JobSubmissionService()

    async def submit(self, current_user: User, request: JobSubmitRequestLike) -> JobSubmitResult:
        return await self.submission_service.submit(current_user, request)

    async def get_owned_job(
        self,
        db: AsyncSession,
        job_uuid: str,
        user_id: int,
    ) -> ProcessingJob:
        job = await self.repository.get_by_uuid(db, job_uuid)
        if not job:
            raise ResourceNotFoundException(
                resource_type="job", resource_id=job_uuid, code=ErrorCode.JOB_NOT_FOUND
            )
        if job.user_id != user_id:
            raise UnauthorizedException(code=ErrorCode.NO_ACCESS, details={"job_id": job_uuid})
        return job

    async def detail(self, db: AsyncSession, job_uuid: str, user_id: int) -> JobDetail:
        await self.get_owned_job(db, job_uuid, user_id)
        from app.db.worker_session import get_db_session

        sync_db = get_db_session()
        try:
            return sync_job_service.get_detail(sync_db, job_uuid)
        finally:
            sync_db.close()

    async def batch_status(
        self,
        db: AsyncSession,
        job_uuids: list[str],
        user_id: int,
    ) -> dict[str, JobStatusEntry]:
        jobs = await self.repository.batch_status(db, job_uuids, user_id)
        return {
            job.job_uuid: {
                "state": job.state,
                "progress": job.progress,
                "error": job.error,
                "score_id": None,
            }
            for job in jobs
        }

    async def delete(self, db: AsyncSession, job_uuid: str, user_id: int) -> None:
        job = await self.get_owned_job(db, job_uuid, user_id)
        if job.state == ProcessingJobState.PROGRESS:
            raise ValidationException(code=ErrorCode.JOB_RUNNING, field="state")
        require_persisted_id(job.id, entity="processing job")
        await db.delete(job)
        await db.commit()


job_service = JobService()
