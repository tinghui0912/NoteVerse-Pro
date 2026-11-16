"""Import notification and browser consequences participate in the owning transaction."""

from datetime import datetime
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import ImportJob, Notification, NotificationKind, RealtimeChangeKind
from app.db.models.import_job import ImportJobState
from app.modules.notifications.service import notification_service
from app.modules.realtime.publisher import publish_change


def admit_import_processing_outcome(db: Session, job: ImportJob, *, created_at: datetime) -> None:
    if job.state not in {ImportJobState.READY_FOR_REVIEW, ImportJobState.FAILED}:
        raise ValueError("Import consequences require an accepted processing outcome")
    ready_for_review = job.state == ImportJobState.READY_FOR_REVIEW
    options = job.requested_options if isinstance(job.requested_options, dict) else {}
    display_title = options.get("display_title")
    display_title = display_title if isinstance(display_title, str) else None
    if ready_for_review:
        notification_service.admit_import_ready_for_review(
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


def admit_import_confirmation_consequences(
    db: Session, job: ImportJob, *, score_id: str, score_display_title: str
) -> None:
    if job.state != ImportJobState.CONFIRMED:
        raise ValueError("Import confirmation consequences require a confirmed Score")
    notification = db.scalar(
        select(Notification)
        .where(
            Notification.dedupe_key
            == f"{NotificationKind.IMPORT_READY_FOR_REVIEW}:{job.job_uuid}:{job.user_id}",
            Notification.recipient_user_id == job.user_id,
            Notification.kind == NotificationKind.IMPORT_READY_FOR_REVIEW,
            Notification.import_job_id == job.job_uuid,
        )
        .with_for_update()
        .execution_options(populate_existing=True)
    )
    if notification is not None and (
        notification.score_id != score_id
        or notification.score_display_title_snapshot != score_display_title
    ):
        notification.score_id = score_id
        notification.score_display_title_snapshot = score_display_title
        publish_change(
            db,
            recipient_user_id=job.user_id,
            kind=RealtimeChangeKind.NOTIFICATIONS_CHANGED,
            notification_id=notification.notification_uuid,
        )
    publish_change(
        db,
        recipient_user_id=job.user_id,
        kind=RealtimeChangeKind.IMPORT_JOBS_CHANGED,
        import_job_id=job.job_uuid,
    )
