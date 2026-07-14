from __future__ import annotations

from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.db.model_utils import require_persisted_id
from app.db.models import ImportArtifact, ImportJobStep, StorageUsageCategory
from app.db.models.import_job import ImportJobState, ImportJobStepStatus
from app.modules.import_jobs.repository import SyncImportJobRepository
from app.modules.import_jobs.schemas import ImportJobArtifactItem, ImportJobDetail
from app.modules.notifications.sync_service import SyncNotificationService, sync_notification_service
from app.modules.storage_usage.service import storage_usage_service
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.modules.score_assets.render_outbox_service import create_review_thumbnail_render_outbox_sync
from app.utils.timezone import utc_now_naive


class SyncImportJobService:
    def __init__(
        self,
        repository: SyncImportJobRepository | None = None,
        notification_service: SyncNotificationService | None = None,
    ) -> None:
        self.repository = repository or SyncImportJobRepository()
        self.notification_service = notification_service or sync_notification_service

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
        state: ImportJobState | str,
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
        job.state = state if isinstance(state, ImportJobState) else ImportJobState(state)
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
        job.state = ImportJobState.PENDING_REVIEW
        job.progress = 100
        job.last_heartbeat_at = now
        job.finished_at = now
        job.updated_at = now
        review_xml = (
            db.query(ImportArtifact)
            .filter_by(
                job_id=job.id,
                kind=ImportArtifactKind.REVIEW_MUSICXML.value,
            )
            .one_or_none()
        )
        if review_xml is not None and review_xml.sha256:
            create_review_thumbnail_render_outbox_sync(
                db,
                import_job_id=require_persisted_id(job.id, entity="import job"),
                source_fingerprint=review_xml.sha256,
            )
        db.commit()
        self._notify_success(db, job)

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
        job.state = ImportJobState.FAILURE
        job.progress = 0
        job.error = error
        job.error_type = error_type
        job.code = code or job.code
        job.last_heartbeat_at = now
        job.finished_at = now
        job.updated_at = now
        db.commit()
        self.notification_service.notify_import_failed_best_effort(
            db,
            job_uuid=job.job_uuid,
            recipient_user_id=job.user_id,
            code=job.code,
            error_type=job.error_type,
        )

    def _notify_success(self, db: Session, job) -> None:
        requested_options = job.requested_options if isinstance(job.requested_options, dict) else {}
        requested_title = requested_options.get("title")
        self.notification_service.notify_import_completed_best_effort(
            db,
            job_uuid=job.job_uuid,
            recipient_user_id=job.user_id,
            title=requested_title if isinstance(requested_title, str) else None,
        )

    def upsert_step(
        self,
        db: Session,
        job_uuid: str,
        name: str,
        status: ImportJobStepStatus | str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        step_order: Optional[int] = None,
    ) -> ImportJobStep:
        self._reset_session(db)
        job = self.repository.get_by_uuid(db, job_uuid)
        if not job:
            raise ValueError(f"Job {job_uuid} not found")
        job_id = require_persisted_id(job.id, entity="import job")
        step = self.repository.get_step(db, job_id, name)
        normalized = status if isinstance(status, ImportJobStepStatus) else ImportJobStepStatus(status.upper())
        if step:
            step.status = normalized
            step.start_time = start_time or step.start_time
            step.end_time = end_time or step.end_time
            step.step_order = step_order if step_order is not None else step.step_order
        else:
            step = ImportJobStep(
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
        items: list[ImportJobArtifactItem],
    ) -> None:
        job = self.repository.get_by_uuid(db, job_uuid)
        if not job:
            raise ValueError(f"Job {job_uuid} not found")
        job_id = require_persisted_id(job.id, entity="import job")
        previous = [
            (artifact.artifact_uuid, artifact.storage_key, artifact.size_bytes or 0)
            for artifact in self.repository.list_artifacts(db, job_id)
            if artifact.kind == kind
        ]
        self.repository.delete_artifacts_by_kind(db, job_id, kind)
        created: list[ImportArtifact] = []
        for item in items:
            artifact = ImportArtifact(
                job_id=job_id,
                kind=kind,
                storage_backend=item["storage_backend"],
                storage_key=item["storage_key"],
                filename=item["filename"],
                page_number=item["page_number"],
                size_bytes=item["size"],
                mime_type=item["mime_type"],
                sha256=item["sha256"],
            )
            db.add(artifact)
            created.append(artifact)
        db.commit()
        for artifact_uuid, storage_key, size_bytes in previous:
            storage_usage_service.record_release_sync(
                db,
                user_id=job.user_id,
                category=StorageUsageCategory.TEMP_IMPORT,
                bytes_count=size_bytes,
                reason="import_artifact_replaced",
                object_type="import_artifact",
                object_id=artifact_uuid,
                storage_key=storage_key,
            )
        for artifact in created:
            storage_usage_service.record_allocation_sync(
                db,
                user_id=job.user_id,
                category=StorageUsageCategory.TEMP_IMPORT,
                bytes_count=artifact.size_bytes or 0,
                reason="import_artifact_created",
                object_type="import_artifact",
                object_id=artifact.artifact_uuid,
                storage_key=artifact.storage_key,
            )

    def get_detail(self, db: Session, job_uuid: str) -> ImportJobDetail:
        job = self.repository.get_by_uuid(db, job_uuid)
        if not job:
            return {"error": "Job not found"}
        job_id = require_persisted_id(job.id, entity="import job")
        requested_options = job.requested_options or {}
        requested_title = requested_options.get("title")
        requested_taxonomy_tags = requested_options.get("taxonomy_tags")
        artifacts: dict[str, list[ImportJobArtifactItem]] = {}
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

        def first_artifact(kind: str) -> ImportJobArtifactItem | None:
            items = artifacts.get(kind)
            return items[0] if items else None

        thumbnail = first_artifact(ImportArtifactKind.REVIEW_PREVIEW_IMAGE.value)
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
                "upload_id": upload.upload_uuid,
                "sha256": blob.sha256,
                "original_filename": upload.original_filename,
            } for _, upload, blob in self.repository.list_upload_rows(db, job_id)],
        }


sync_import_job_service = SyncImportJobService()
