from __future__ import annotations
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
    ImportArtifact,
    ImportJobStep,
    StorageUsageCategory,
)
from app.db.models.import_job import ImportJobState, ImportJobStepStatus
from app.modules.durable_work.failure import (
    DurableFailure,
    set_failure_facts,
    clear_failure_facts,
)
from app.modules.import_jobs.dispatch_service import (
    ImportExecutionLease,
    require_current_attempt,
    TERMINAL_IMPORT_STATES,
)
from app.modules.import_jobs.repository import ImportJobRepository
from app.modules.import_jobs.artifact_records import ImportJobStoredArtifactItem
from app.modules.import_jobs.notifications import admit_import_outcome
from app.modules.storage_usage.service import storage_usage_service
from app.modules.import_jobs.artifact_kinds import ImportArtifactKind
from app.modules.score_assets.render_outbox_service import (
    create_review_thumbnail_render_outbox,
)
from app.shared.time import utc_now


class ImportJobExecutionService:
    def __init__(
        self,
        repository: ImportJobRepository | None = None,
    ) -> None:
        self.repository = repository or ImportJobRepository()

    def update_progress(
        self,
        db: Session,
        lease: ImportExecutionLease,
        state: ImportJobState | str,
        progress: int,
        current_step: Optional[str] = None,
        started_at: Optional[datetime] = None,
    ) -> None:
        job = require_current_attempt(db, lease)
        job.state = state if isinstance(state, ImportJobState) else ImportJobState(state)
        job.progress = progress
        job.current_step = current_step or job.current_step
        if started_at is not None and job.started_at is None:
            job.started_at = started_at
        now = utc_now()
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
        if job.state in TERMINAL_IMPORT_STATES:
            db.commit()
            return
        now = utc_now()
        job.state = ImportJobState.PENDING_REVIEW
        job.progress = 100
        job.last_heartbeat_at = now
        job.finished_at = now
        clear_failure_facts(job)
        job.updated_at = now
        review_xml = db.execute(
            select(ImportArtifact).where(
                ImportArtifact.job_id == job.id,
                ImportArtifact.kind == ImportArtifactKind.REVIEW_MUSICXML.value,
            )
        ).scalar_one_or_none()
        if review_xml is not None and review_xml.stored_object.sha256:
            create_review_thumbnail_render_outbox(
                db,
                import_job_id=require_persisted_id(job.id, entity="import job"),
                source_fingerprint=review_xml.stored_object.sha256,
            )
        admit_import_outcome(db, job, created_at=now)
        db.commit()

    def finalize_failure(
        self,
        db: Session,
        lease: ImportExecutionLease,
        *,
        failure: DurableFailure,
        detail: str | None = None,
    ) -> None:
        job = require_current_attempt(db, lease)
        if job.state in TERMINAL_IMPORT_STATES:
            db.commit()
            return
        now = utc_now()
        job.state = ImportJobState.FAILURE
        job.progress = 0
        set_failure_facts(job, failure, detail=detail)
        job.last_heartbeat_at = now
        job.finished_at = now
        job.updated_at = now
        admit_import_outcome(db, job, created_at=now)
        db.commit()

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
                start_time=start_time or utc_now(),
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
            storage_usage_service.record_release(
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
            storage_usage_service.record_allocation(
                db,
                user_id=job.user_id,
                category=StorageUsageCategory.TEMP_IMPORT,
                bytes_count=artifact.stored_object.byte_size or 0,
                reason="import_artifact_created",
                object_type="import_artifact",
                object_id=artifact.artifact_uuid,
                storage_key=artifact.stored_object.object_key,
            )
        db.commit()


import_job_execution_service = ImportJobExecutionService()
