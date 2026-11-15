"""Import notification and browser consequences participate in the owning transaction."""

from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import ImportJob, NotificationEvent
from app.db.models.import_job import ImportJobState
from app.modules.notifications.service import notification_service, NotificationTypes
from app.modules.realtime.publisher import publish_event, RealtimeEventTypes


def admit_import_outcome(db: Session, job: ImportJob, *, created_at: datetime) -> None:
    if job.state not in {ImportJobState.PENDING_REVIEW, ImportJobState.FAILURE}:
        raise ValueError("Import consequences require an accepted terminal outcome")
    completed = job.state == ImportJobState.PENDING_REVIEW
    notification_type = (
        NotificationTypes.IMPORT_COMPLETED if completed else NotificationTypes.IMPORT_FAILED
    )
    options = job.requested_options if isinstance(job.requested_options, dict) else {}
    title = options.get("title")
    title = title if isinstance(title, str) else None
    notification_service.admit_event(
        db,
        recipient_user_id=job.user_id,
        actor_user_id=None,
        type=notification_type,
        resource_type="job",
        resource_id=job.job_uuid,
        title="Processing complete" if completed else "Processing failed",
        body=f"{title or 'Your score'} is ready for review."
        if completed
        else "We could not finish processing your score.",
        data={"job_id": job.job_uuid, "job_title": title}
        if completed
        else {"job_id": job.job_uuid},
        dedupe_key=f"{notification_type}:{job.job_uuid}:{job.user_id}",
        created_at=created_at,
    )
    publish_event(
        db,
        recipient_user_id=job.user_id,
        type=RealtimeEventTypes.IMPORT_JOB_COMPLETED
        if completed
        else RealtimeEventTypes.IMPORT_JOB_FAILED,
        resource_type="job",
        resource_id=job.job_uuid,
        payload={},
    )


def enrich_completed_import_notification(
    db: Session, *, job_id: str, user_id: int, score_id: str, score_title: str
) -> None:
    notification = db.scalar(
        select(NotificationEvent)
        .where(
            NotificationEvent.dedupe_key
            == f"{NotificationTypes.IMPORT_COMPLETED}:{job_id}:{user_id}",
            NotificationEvent.recipient_user_id == user_id,
            NotificationEvent.type == NotificationTypes.IMPORT_COMPLETED,
            NotificationEvent.resource_type == "job",
            NotificationEvent.resource_id == job_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if notification is not None:
        notification.score_id = score_id
        notification.data = {
            **(notification.data or {}),
            "score_id": score_id,
            "score_title": score_title,
        }
