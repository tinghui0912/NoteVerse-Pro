from __future__ import annotations

import json
from typing import Any, Iterable

from sqlalchemy import select, text
from sqlalchemy.orm import Session
from sqlmodel import col

from app.core.logger import logger
from app.db.models import RealtimeEvent, Score, ScoreMembership

REALTIME_NOTIFY_CHANNEL = "realtime_events"


class RealtimeEventTypes:
    NOTIFICATION_CREATED = "notification.created"
    SCORE_REVISION_CREATED = "score.revision.created"
    SCORE_DERIVED_ASSET_UPDATED = "score.derived_asset.updated"
    SCORE_METADATA_UPDATED = "score.metadata.updated"
    IMPORT_JOB_COMPLETED = "import_job.completed"
    IMPORT_JOB_FAILED = "import_job.failed"


def _unique_user_ids(user_ids: Iterable[int | None]) -> list[int]:
    return sorted({int(user_id) for user_id in user_ids if user_id is not None})


def _notification_payload(event: RealtimeEvent) -> str:
    return json.dumps(
        {
            "event_id": event.id,
            "recipient_user_id": event.recipient_user_id,
        },
        separators=(",", ":"),
    )


def _notify_event(db: Session, event: RealtimeEvent) -> None:
    if db.get_bind().dialect.name != "postgresql" or event.id is None:
        return
    db.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {"channel": REALTIME_NOTIFY_CHANNEL, "payload": _notification_payload(event)},
    )


def score_recipients(db: Session, score_uuid: str) -> list[int]:
    score = db.execute(
        select(Score).where(
            Score.score_uuid == score_uuid,
            Score.__table__.c.deleted_at.is_(None),
        )
    ).scalar_one_or_none()
    if score is None or score.id is None:
        return []
    member_rows = db.execute(
        select(ScoreMembership.user_id).where(
            ScoreMembership.score_id == score.id,
            col(ScoreMembership.revoked_at).is_(None),
        )
    )
    return _unique_user_ids([score.owner_user_id, *member_rows.scalars().all()])


def publish_event_best_effort(
    db: Session,
    **kwargs: Any,
) -> None:
    try:
        publish_event(db, **kwargs)
        db.commit()
    except Exception:
        db.rollback()
        logger.bind(
            event="realtime.event.publish_failed",
            event_type=kwargs.get("type"),
            recipient_user_id=kwargs.get("recipient_user_id"),
            resource_type=kwargs.get("resource_type"),
            resource_id=kwargs.get("resource_id"),
            score_id=kwargs.get("score_id"),
            revision_id=kwargs.get("revision_id"),
        ).opt(exception=True).warning("Realtime event publish failed")


def publish_event(
    db: Session,
    *,
    recipient_user_id: int,
    type: str,
    payload: dict[str, Any],
    resource_type: str | None = None,
    resource_id: str | None = None,
    score_id: str | None = None,
    revision_id: str | None = None,
) -> RealtimeEvent:
    event = RealtimeEvent(
        recipient_user_id=recipient_user_id,
        type=type,
        resource_type=resource_type,
        resource_id=resource_id,
        score_id=score_id,
        revision_id=revision_id,
        payload=payload,
    )
    db.add(event)
    db.flush()
    _notify_event(db, event)
    return event


def publish_score_event(
    db: Session,
    *,
    score_id: str,
    revision_id: str | None,
    type: str,
    payload: dict[str, Any],
    resource_type: str = "score",
    resource_id: str | None = None,
) -> None:
    """Persist all recipient rows and transactional wake-ups; caller owns the transaction.

    Publication failures propagate, including partial fan-out and pg_notify failures.
    """
    for recipient_user_id in score_recipients(db, score_id):
        publish_event(
            db,
            recipient_user_id=recipient_user_id,
            type=type,
            resource_type=resource_type,
            resource_id=resource_id or score_id,
            score_id=score_id,
            revision_id=revision_id,
            payload=payload,
        )
