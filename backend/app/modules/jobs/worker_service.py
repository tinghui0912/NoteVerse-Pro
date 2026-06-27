from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.db.model_utils import require_persisted_id
from app.db.models import ProcessingArtifact, ProcessingJobStep
from app.db.models.processing_job import ProcessingJobState, ProcessingJobStepStatus
from app.modules.jobs.repository import SyncJobRepository
from app.modules.jobs.schemas import JobArtifactItem, JobDetail
from app.utils.timezone import utc_now_naive


class SyncJobService:
    def __init__(self, repository: SyncJobRepository | None = None) -> None:
        self.repository = repository or SyncJobRepository()

    @staticmethod
    def _reset_session(db: Session) -> None:
        db.expire_all()
        try:
            db.commit()
        except Exception:
            db.rollback()

    def update_progress(
        self,
        db: Session,
        job_uuid: str,
        state: ProcessingJobState | str,
        progress: int,
        current_step: Optional[str] = None,
        code: Optional[str] = None,
        error: Optional[str] = None,
        error_type: Optional[str] = None,
        started_at: Optional[datetime] = None,
    ) -> None:
        self._reset_session(db)
        job = self.repository.get_by_uuid(db, job_uuid)
        if not job:
            return
        job.state = state if isinstance(state, ProcessingJobState) else ProcessingJobState(state)
        job.progress = progress
        job.current_step = current_step or job.current_step
        job.code = code if code is not None else job.code
        job.error = error if error is not None else job.error
        job.error_type = error_type if error_type is not None else job.error_type
        if started_at is not None and job.started_at is None:
            job.started_at = started_at
        now = utc_now_naive()
        job.last_heartbeat_at = now
        job.updated_at = now
        db.commit()

    def finalize_success(
        self,
        db: Session,
        job_uuid: str,
        total_time_seconds: Optional[int] = None,
    ) -> None:
        self._reset_session(db)
        job = self.repository.get_by_uuid(db, job_uuid)
        if not job:
            return
        now = utc_now_naive()
        job.state = ProcessingJobState.PENDING_REVIEW
        job.progress = 100
        job.last_heartbeat_at = now
        job.finished_at = now
        job.updated_at = now
        db.commit()

    def finalize_failure(
        self,
        db: Session,
        job_uuid: str,
        error: str,
        error_type: str,
        code: Optional[str] = None,
    ) -> None:
        self._reset_session(db)
        job = self.repository.get_by_uuid(db, job_uuid)
        if not job:
            return
        now = utc_now_naive()
        job.state = ProcessingJobState.FAILURE
        job.progress = 0
        job.error = error
        job.error_type = error_type
        job.code = code or job.code
        job.last_heartbeat_at = now
        job.finished_at = now
        job.updated_at = now
        db.commit()

    def upsert_step(
        self,
        db: Session,
        job_uuid: str,
        name: str,
        status: ProcessingJobStepStatus | str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        step_order: Optional[int] = None,
    ) -> ProcessingJobStep:
        self._reset_session(db)
        job = self.repository.get_by_uuid(db, job_uuid)
        if not job:
            raise ValueError(f"Job {job_uuid} not found")
        job_id = require_persisted_id(job.id, entity="processing job")
        step = self.repository.get_step(db, job_id, name)
        normalized = status if isinstance(status, ProcessingJobStepStatus) else ProcessingJobStepStatus(status.upper())
        if step:
            step.status = normalized
            step.start_time = start_time or step.start_time
            step.end_time = end_time or step.end_time
            step.step_order = step_order if step_order is not None else step.step_order
        else:
            step = ProcessingJobStep(
                job_id=job_id,
                name=name,
                status=normalized,
                start_time=start_time or utc_now_naive(),
                end_time=end_time,
                step_order=step_order or 0,
            )
            db.add(step)
        db.commit()
        return step

    def replace_artifacts(
        self,
        db: Session,
        job_uuid: str,
        kind: str,
        items: list[JobArtifactItem],
    ) -> None:
        job = self.repository.get_by_uuid(db, job_uuid)
        if not job:
            raise ValueError(f"Job {job_uuid} not found")
        job_id = require_persisted_id(job.id, entity="processing job")
        self.repository.delete_artifacts_by_kind(db, job_id, kind)
        for item in items:
            db.add(ProcessingArtifact(
                job_id=job_id,
                kind=kind,
                storage_backend=item["storage_backend"],
                storage_key=item["storage_key"],
                filename=item["filename"],
                page_number=item["page_number"],
                size_bytes=item["size"],
                mime_type=item["mime_type"],
                sha256=item["sha256"],
            ))
        db.commit()

    def get_detail(self, db: Session, job_uuid: str) -> JobDetail:
        job = self.repository.get_by_uuid(db, job_uuid)
        if not job:
            return {"error": "Job not found"}
        job_id = require_persisted_id(job.id, entity="processing job")
        requested_options = job.requested_options or {}
        requested_title = requested_options.get("title")
        requested_taxonomy_tags = requested_options.get("taxonomy_tags")
        artifacts: dict[str, list[JobArtifactItem]] = {}
        for row in self.repository.list_artifacts(db, job_id):
            artifacts.setdefault(row.kind, []).append({
                "artifact_id": row.artifact_uuid,
                "storage_backend": row.storage_backend,
                "storage_key": row.storage_key,
                "filename": row.filename,
                "page_number": row.page_number,
                "size": row.size_bytes,
                "mime_type": row.mime_type,
                "sha256": row.sha256,
            })
        thumbnail = (
            (artifacts.get("preview_image") or [None])[0]
            or (artifacts.get("original_image") or [None])[0]
        )
        return {
            "job_id": job.job_uuid,
            "score_id": self.repository.get_score_uuid(db, job.score_id),
            "state": job.state,
            "progress": job.progress,
            "current_step": job.current_step,
            "title": requested_title if isinstance(requested_title, str) else None,
            "taxonomy_tags": (
                requested_taxonomy_tags if isinstance(requested_taxonomy_tags, list) else []
            ),
            "thumbnail_artifact_id": thumbnail.get("artifact_id") if thumbnail else None,
            "created_at": job.created_at.isoformat(),
            "updated_at": job.updated_at.isoformat(),
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "finished_at": job.finished_at.isoformat() if job.finished_at else None,
            "error": job.error,
            "code": job.code,
            "steps": [{
                "name": step.name,
                "status": step.status.value,
                "start_time": step.start_time.isoformat() if step.start_time else None,
                "end_time": step.end_time.isoformat() if step.end_time else None,
            } for step in self.repository.list_steps(db, job_id)],
            "artifacts": artifacts,
            "upload_ids": [{
                "upload_id": upload.id,
                "sha256": upload.sha256,
                "original_filename": upload.original_filename,
            } for _, upload in self.repository.list_upload_rows(db, job_id)],
        }


sync_job_service = SyncJobService()
