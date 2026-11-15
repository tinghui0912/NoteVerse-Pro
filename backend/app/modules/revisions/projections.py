"""Revision-owned DB projections use the immutable fact-time audience."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import NotificationEvent
from app.db.models.domain_event import DomainEvent
from app.modules.domain_events.definitions import DomainFact
from app.modules.domain_events.projections import ProjectionDefinition, run_projections
from app.modules.revisions.events import ScoreRevisionCreated
from app.modules.notifications.service import NotificationTypes
from app.modules.realtime.publisher import publish_event, RealtimeEventTypes


def project_revision_notification(db: Session, event: DomainEvent, fact: DomainFact) -> None:
    if not isinstance(fact, ScoreRevisionCreated):
        raise TypeError("Revision projection requires a revision fact")
    if fact.is_initial:
        return
    for recipient in fact.audience_user_ids:
        if recipient == fact.actor_user_id:
            continue
        key = f"{NotificationTypes.SCORE_VERSION_CREATED}:{fact.revision_id}:{recipient}"
        if (
            db.scalar(select(NotificationEvent.id).where(NotificationEvent.dedupe_key == key))
            is not None
        ):
            continue
        row = NotificationEvent(
            recipient_user_id=recipient,
            actor_user_id=fact.actor_user_id,
            type=NotificationTypes.SCORE_VERSION_CREATED,
            dedupe_key=key,
            resource_type="score",
            resource_id=fact.score_id,
            score_id=fact.score_id,
            title="Score version saved",
            body=f"{fact.actor_name} saved a new version of {fact.score_title}.",
            data={"score_title": fact.score_title},
            created_at=event.occurred_at,
        )
        db.add(row)
        db.flush()
        publish_event(
            db,
            recipient_user_id=recipient,
            type=RealtimeEventTypes.NOTIFICATION_CREATED,
            resource_type="notification",
            resource_id=row.notification_uuid,
            score_id=fact.score_id,
            payload={},
        )


def project_revision_realtime(db: Session, event: DomainEvent, fact: DomainFact) -> None:
    if not isinstance(fact, ScoreRevisionCreated):
        raise TypeError("Revision projection requires a revision fact")
    if not fact.is_initial:
        for recipient in fact.audience_user_ids:
            publish_event(
                db,
                recipient_user_id=recipient,
                type=RealtimeEventTypes.SCORE_REVISION_CREATED,
                resource_type="score",
                resource_id=fact.score_id,
                score_id=fact.score_id,
                revision_id=fact.revision_id,
                payload={},
            )


REVISION_PROJECTIONS = (
    ProjectionDefinition(
        "revision_notifications_v1", (ScoreRevisionCreated,), project_revision_notification
    ),
    ProjectionDefinition(
        "revision_realtime_v1", (ScoreRevisionCreated,), project_revision_realtime
    ),
)


def catch_up_revision_projections(db: Session) -> None:
    run_projections(db, REVISION_PROJECTIONS)
