from __future__ import annotations

import logging
import json
from typing import Any, Iterable

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session
from sqlmodel import col

from app.core.config import settings
from app.db.models import RealtimeEvent, Score, ScoreDeletionStatus, ScoreMembership

logger = logging.getLogger(__name__)
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


def _supports_postgres_notify() -> bool:
    return settings.DATABASE_URL.startswith(("postgresql://", "postgresql+"))


def _notification_payload(event: RealtimeEvent) -> str:
    return json.dumps(
        {
            "event_id": event.id,
            "recipient_user_id": event.recipient_user_id,
        },
        separators=(",", ":"),
    )


async def _notify_event(db: AsyncSession, event: RealtimeEvent) -> None:
    if not _supports_postgres_notify() or event.id is None:
        return
    await db.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {"channel": REALTIME_NOTIFY_CHANNEL, "payload": _notification_payload(event)},
    )


def _notify_event_sync(db: Session, event: RealtimeEvent) -> None:
    if not _supports_postgres_notify() or event.id is None:
        return
    db.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {"channel": REALTIME_NOTIFY_CHANNEL, "payload": _notification_payload(event)},
    )


async def score_recipients(db: AsyncSession, score_uuid: str) -> list[int]:
    score = (
        await db.execute(
            select(Score).where(
                Score.score_uuid == score_uuid,
                Score.deletion_status == ScoreDeletionStatus.ACTIVE,
            )
        )
    ).scalar_one_or_none()
    if score is None or score.id is None:
        return []
    member_rows = await db.execute(
        select(ScoreMembership.user_id).where(
            ScoreMembership.score_id == score.id,
            col(ScoreMembership.revoked_at).is_(None),
        )
    )
    return _unique_user_ids([score.owner_user_id, *member_rows.scalars().all()])


def score_recipients_sync(db: Session, score_uuid: str) -> list[int]:
    score = db.execute(
        select(Score).where(
            Score.score_uuid == score_uuid,
            Score.deletion_status == ScoreDeletionStatus.ACTIVE,
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


async def publish_event(
    db: AsyncSession,
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
    await db.flush()
    await _notify_event(db, event)
    return event


async def publish_event_best_effort(
    db: AsyncSession,
    **kwargs: Any,
) -> None:
    try:
        await publish_event(db, **kwargs)
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception("Failed to publish realtime event", extra={"type": kwargs.get("type")})


async def publish_score_event_best_effort(
    db: AsyncSession,
    *,
    score_id: str,
    revision_id: str | None,
    type: str,
    payload: dict[str, Any],
    resource_type: str = "score",
    resource_id: str | None = None,
) -> None:
    try:
        recipients = await score_recipients(db, score_id)
        for recipient_user_id in recipients:
            await publish_event(
                db,
                recipient_user_id=recipient_user_id,
                type=type,
                resource_type=resource_type,
                resource_id=resource_id or score_id,
                score_id=score_id,
                revision_id=revision_id,
                payload=payload,
            )
        await db.commit()
    except Exception:
        await db.rollback()
        logger.exception(
            "Failed to publish score realtime event",
            extra={"score_id": score_id, "type": type},
        )


def publish_event_sync(
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
    _notify_event_sync(db, event)
    return event


def publish_score_event_sync_best_effort(
    db: Session,
    *,
    score_id: str,
    revision_id: str | None,
    type: str,
    payload: dict[str, Any],
    resource_type: str = "score",
    resource_id: str | None = None,
) -> None:
    try:
        recipients = score_recipients_sync(db, score_id)
        for recipient_user_id in recipients:
            publish_event_sync(
                db,
                recipient_user_id=recipient_user_id,
                type=type,
                resource_type=resource_type,
                resource_id=resource_id or score_id,
                score_id=score_id,
                revision_id=revision_id,
                payload=payload,
            )
    except Exception:
        logger.exception(
            "Failed to publish score realtime event",
            extra={"score_id": score_id, "type": type},
        )
