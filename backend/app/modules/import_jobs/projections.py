"""Import-owned notification and realtime database representations."""

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import NotificationEvent
from app.core.logger import logger
from app.db.models.domain_event import DomainEvent
from app.modules.domain_events.definitions import DomainFact
from app.modules.domain_events.projections import ProjectionDefinition, run_projections
from app.modules.import_jobs.events import ImportJobCompleted, ImportJobFailed, ImportJobConfirmed
from app.modules.notifications.service import NotificationTypes
from app.modules.realtime.publisher import RealtimeEventTypes, publish_event


def project_import_notification(db: Session, event: DomainEvent, fact: DomainFact) -> None:
    if isinstance(fact, ImportJobConfirmed):
        notification = db.scalar(
            select(NotificationEvent).where(
                NotificationEvent.dedupe_key
                == f"{NotificationTypes.IMPORT_COMPLETED}:{fact.job_id}:{fact.recipient_user_id}",
                NotificationEvent.recipient_user_id == fact.recipient_user_id,
                NotificationEvent.type == NotificationTypes.IMPORT_COMPLETED,
                NotificationEvent.resource_type == "job",
                NotificationEvent.resource_id == fact.job_id,
            )
        )
        if notification is None:
            raise RuntimeError("Import confirmation requires its completed notification projection")
        notification.score_id = fact.score_id
        notification.data = {
            **(notification.data or {}),
            "score_id": fact.score_id,
            "score_title": fact.score_title,
        }
        return
    if not isinstance(fact, (ImportJobCompleted, ImportJobFailed)):
        raise TypeError("Import notification requires an Import fact")
    completed = isinstance(fact, ImportJobCompleted)
    notification_type = (
        NotificationTypes.IMPORT_COMPLETED if completed else NotificationTypes.IMPORT_FAILED
    )
    dedupe_key = f"{notification_type}:{fact.job_id}:{fact.recipient_user_id}"
    if (
        db.scalar(select(NotificationEvent.id).where(NotificationEvent.dedupe_key == dedupe_key))
        is not None
    ):
        return
    notification = NotificationEvent(
        recipient_user_id=fact.recipient_user_id,
        actor_user_id=None,
        type=notification_type,
        dedupe_key=dedupe_key,
        resource_type="job",
        resource_id=fact.job_id,
        score_id=None,
        title="Processing complete" if completed else "Processing failed",
        body=f"{fact.requested_title or 'Your score'} is ready for review."
        if isinstance(fact, ImportJobCompleted)
        else "We could not finish processing your score.",
        data={"job_id": fact.job_id, "job_title": fact.requested_title}
        if isinstance(fact, ImportJobCompleted)
        else {"job_id": fact.job_id},
        created_at=event.occurred_at,
    )
    db.add(notification)
    db.flush()
    publish_event(
        db,
        recipient_user_id=fact.recipient_user_id,
        type=RealtimeEventTypes.NOTIFICATION_CREATED,
        resource_type="notification",
        resource_id=notification.notification_uuid,
        score_id=None,
        payload={},
    )


def project_import_realtime(db: Session, event: DomainEvent, fact: DomainFact) -> None:
    if not isinstance(fact, (ImportJobCompleted, ImportJobFailed)):
        raise TypeError("Import realtime requires an Import fact")
    publish_event(
        db,
        recipient_user_id=fact.recipient_user_id,
        type=RealtimeEventTypes.IMPORT_JOB_COMPLETED
        if isinstance(fact, ImportJobCompleted)
        else RealtimeEventTypes.IMPORT_JOB_FAILED,
        resource_type="job",
        resource_id=fact.job_id,
        payload={},
    )


IMPORT_PROJECTIONS = (
    ProjectionDefinition(
        "import_notifications_v1",
        (ImportJobCompleted, ImportJobFailed, ImportJobConfirmed),
        project_import_notification,
    ),
    ProjectionDefinition(
        "import_realtime_v1", (ImportJobCompleted, ImportJobFailed), project_import_realtime
    ),
)


def catch_up_import_projections_best_effort(db: Session) -> None:
    try:
        run_projections(db, IMPORT_PROJECTIONS)
    except Exception as exc:
        # Each failed projection logs its identity and rolls back its own batch.
        # The journal transaction is already committed and remains authoritative.
        logger.bind(
            event="domain_projection.fast_path_failed", error_class=type(exc).__name__
        ).warning("domain_projection.fast_path_failed")
