from __future__ import annotations
from app.modules.import_jobs.schemas import processing_options_adapter
from app.modules.storage_objects.writes import (
    adopt_written_object,
    receipt_for_intent,
    ObjectWriteReceipt,
)

from datetime import datetime
from typing import Optional

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.model_utils import require_persisted_id
from app.db.models import (
    ExecutionManifest,
    ImportArtifact,
    ImportJobStep,
    StorageUsageCategory,
)
from app.db.models.import_job import ImportJobState, ImportJobStepStatus
from app.modules.async_operations.diagnostics import (
    AsyncOperationKindValue,
    AsyncOperationStatusValue,
    apply_async_diagnostic,
    clear_async_diagnostic,
)
from app.modules.import_jobs.public_errors import public_import_job_error
from app.modules.import_jobs.dispatch_service import ImportExecutionLease, require_current_attempt
from app.modules.import_jobs.repository import SyncImportJobRepository
from app.modules.import_jobs.artifact_records import ImportJobStoredArtifactItem
from app.modules.import_jobs.schemas import (
    ImportJobDetail,
)
from app.modules.notifications.sync_service import (
    SyncNotificationService,
    sync_notification_service,
)
from app.modules.storage_usage.service import storage_usage_service
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.modules.score_assets.render_outbox_service import (
    create_review_thumbnail_render_outbox_sync,
)
from app.shared.constants import ErrorCode
from app.utils.timezone import utc_now_naive


class SyncImportJobService:
    def __init__(
        self,
        repository: SyncImportJobRepository | None = None,
        notification_service: SyncNotificationService | None = None,
    ) -> None:
        self.repository = repository or SyncImportJobRepository()
        self.notification_service = notification_service or sync_notification_service

    def update_progress(
        self,
        db: Session,
        lease: ImportExecutionLease,
        state: ImportJobState | str,
        progress: int,
        current_step: Optional[str] = None,
        code: Optional[str] = None,
        error: Optional[str] = None,
        error_type: Optional[str] = None,
        started_at: Optional[datetime] = None,
    ) -> None:
        job = require_current_attempt(db, lease)
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
        lease: ImportExecutionLease,
        total_time_seconds: Optional[int] = None,
    ) -> None:
        job = require_current_attempt(db, lease)
        now = utc_now_naive()
        job.state = ImportJobState.PENDING_REVIEW
        job.progress = 100
        job.last_heartbeat_at = now
        job.finished_at = now
        clear_async_diagnostic(job)
        job.updated_at = now
        review_xml = db.execute(
            select(ImportArtifact).where(
                ImportArtifact.job_id == job.id,
                ImportArtifact.kind == ImportArtifactKind.REVIEW_MUSICXML.value,
            )
        ).scalar_one_or_none()
        if review_xml is not None and review_xml.stored_object.sha256:
            create_review_thumbnail_render_outbox_sync(
                db,
                import_job_id=require_persisted_id(job.id, entity="import job"),
                source_fingerprint=review_xml.stored_object.sha256,
            )
        db.commit()
        require_current_attempt(db, lease)
        self._notify_success(db, job)

    def finalize_failure(
        self,
        db: Session,
        lease: ImportExecutionLease,
        error: str,
        error_type: str,
        code: Optional[str] = None,
    ) -> None:
        job = require_current_attempt(db, lease)
        now = utc_now_naive()
        job.state = ImportJobState.FAILURE
        job.progress = 0
        job.error = error
        job.error_type = error_type
        job.code = code or job.code
        apply_async_diagnostic(
            job,
            kind=AsyncOperationKindValue.IMPORT,
            status=AsyncOperationStatusValue.FAILED,
            raw_status=job.state.value,
            last_error=job.error,
            attempts=lease.attempt,
            max_attempts=None,
        )
        job.last_heartbeat_at = now
        job.finished_at = now
        job.updated_at = now
        db.commit()
        require_current_attempt(db, lease)
        self.notification_service.notify_import_failed_best_effort(
            db,
            job_uuid=job.job_uuid,
            recipient_user_id=job.user_id,
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
        lease: ImportExecutionLease,
        name: str,
        status: ImportJobStepStatus | str,
        start_time: Optional[datetime] = None,
        end_time: Optional[datetime] = None,
        step_order: Optional[int] = None,
    ) -> ImportJobStep:
        job = require_current_attempt(db, lease)
        job_id = require_persisted_id(job.id, entity="import job")
        step = self.repository.get_step(db, job_id, name)
        normalized = (
            status
            if isinstance(status, ImportJobStepStatus)
            else ImportJobStepStatus(status.upper())
        )
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
        lease: ImportExecutionLease,
        kind: str,
        items: list[ImportJobStoredArtifactItem],
    ) -> None:
        job = require_current_attempt(db, lease)
        job_id = require_persisted_id(job.id, entity="import job")
        previous = [
            (
                artifact.artifact_uuid,
                artifact.stored_object.object_key,
                artifact.stored_object.byte_size or 0,
            )
            for artifact in self.repository.list_artifacts(db, job_id)
            if artifact.kind == kind
        ]
        self.repository.delete_artifacts_by_kind(db, job_id, kind)
        created: list[ImportArtifact] = []
        for item in items:
            artifact = ImportArtifact(
                job_id=job_id,
                kind=kind,
                stored_object=adopt_written_object(
                    db,
                    ObjectWriteReceipt(
                        item["write_intent_uuid"],
                        item["write_token"],
                        receipt_for_intent(db, item["write_intent_uuid"]).facts,
                    ),
                ),
                filename=item["filename"],
                page_number=item["page_number"],
            )
            db.add(artifact)
            created.append(artifact)
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
                auto_commit=False,
            )
        for artifact in created:
            storage_usage_service.record_allocation_sync(
                db,
                user_id=job.user_id,
                category=StorageUsageCategory.TEMP_IMPORT,
                bytes_count=artifact.stored_object.byte_size or 0,
                reason="import_artifact_created",
                object_type="import_artifact",
                object_id=artifact.artifact_uuid,
                storage_key=artifact.stored_object.object_key,
                auto_commit=False,
            )
        db.commit()

    def get_detail(self, db: Session, job_uuid: str) -> ImportJobDetail:
        job = self.repository.get_by_uuid(db, job_uuid)
        if not job:
            return {
                "public_code": ErrorCode.JOB_NOT_FOUND,
                "public_message": ErrorCode.JOB_NOT_FOUND,
            }
        public_code, public_message = public_import_job_error(job)
        job_id = require_persisted_id(job.id, entity="import job")
        manifest = (
            db.get(ExecutionManifest, job.execution_manifest_id)
            if job.execution_manifest_id is not None
            else None
        )
        manifest_digest = manifest.sha256 if manifest is not None else None
        requested_options = processing_options_adapter.validate_python(
            job.requested_options if job.requested_options is not None else {}
        )
        requested_title = requested_options.get("title")
        artifacts = self.repository.list_artifacts(db, job_id)
        thumbnail_artifact = next(
            (
                artifact
                for artifact in artifacts
                if artifact.kind == ImportArtifactKind.REVIEW_PREVIEW_IMAGE.value
            ),
            None,
        )
        upload_rows = self.repository.list_upload_rows(db, job_id)
        return {
            "job_id": job.job_uuid,
            "score_id": self.repository.get_score_uuid(db, job.score_id),
            "state": job.state,
            "progress": job.progress,
            "title": requested_title if isinstance(requested_title, str) else None,
            "genres": requested_options.get("genres", []),
            "thumbnail": (
                {
                    "artifact_id": thumbnail_artifact.artifact_uuid,
                    "filename": thumbnail_artifact.filename,
                    "page_number": thumbnail_artifact.page_number,
                    "size": thumbnail_artifact.stored_object.byte_size,
                    "mime_type": thumbnail_artifact.stored_object.content_type,
                }
                if thumbnail_artifact
                else None
            ),
            "created_at": job.created_at.isoformat(),
            "updated_at": job.updated_at.isoformat(),
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "finished_at": job.finished_at.isoformat() if job.finished_at else None,
            "public_code": public_code,
            "public_message": public_message,
            "execution_manifest_sha256": manifest_digest,
            "original_images": [
                {
                    "artifact_id": f"upload:{require_persisted_id(upload.id, entity='upload')}",
                    "filename": upload.original_filename,
                    "page_number": job_upload.page_number,
                    "size": blob.byte_size,
                    "mime_type": blob.content_type,
                    "upload_id": upload.upload_uuid,
                    "original_filename": upload.original_filename,
                }
                for job_upload, upload, blob in upload_rows
            ],
        }


sync_import_job_service = SyncImportJobService()
