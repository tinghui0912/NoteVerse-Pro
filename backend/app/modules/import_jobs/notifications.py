"""Import notification and browser consequences participate in the owning transaction."""

from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import ImportJob, Notification, NotificationKind, RealtimeChangeKind
from app.db.models.import_job import ImportJobState
from app.modules.notifications.service import notification_service
from app.modules.realtime.publisher import publish_change


def admit_import_outcome(db: Session, job: ImportJob, *, created_at: datetime) -> None:
    if job.state not in {ImportJobState.PENDING_REVIEW, ImportJobState.FAILURE}:
        raise ValueError("Import consequences require an accepted terminal outcome")
    completed = job.state == ImportJobState.PENDING_REVIEW
    options = job.requested_options if isinstance(job.requested_options, dict) else {}
    display_title = options.get("display_title")
    display_title = display_title if isinstance(display_title, str) else None
    if completed:
        notification_service.admit_import_completed(
            db,
            recipient_user_id=job.user_id,
            import_job_id=job.job_uuid,
            import_display_title=display_title,
            created_at=created_at,
        )
    else:
        notification_service.admit_import_failed(
            db,
            recipient_user_id=job.user_id,
            import_job_id=job.job_uuid,
            import_display_title=display_title,
            created_at=created_at,
        )
    publish_change(
        db,
        recipient_user_id=job.user_id,
        kind=RealtimeChangeKind.IMPORT_JOBS_CHANGED,
        import_job_id=job.job_uuid,
    )


def enrich_completed_import_notification(
    db: Session, *, job_id: str, user_id: int, score_id: str, score_display_title: str
) -> None:
    notification = db.scalar(
        select(Notification)
        .where(
            Notification.dedupe_key == f"{NotificationKind.IMPORT_COMPLETED}:{job_id}:{user_id}",
            Notification.recipient_user_id == user_id,
            Notification.kind == NotificationKind.IMPORT_COMPLETED,
            Notification.import_job_id == job_id,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if notification is not None:
        notification.score_id = score_id
        notification.score_display_title_snapshot = score_display_title
