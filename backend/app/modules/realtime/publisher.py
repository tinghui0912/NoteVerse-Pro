from __future__ import annotations

import json
from typing import Iterable

from sqlalchemy import select, text
from sqlalchemy.orm import Session
from sqlmodel import col

from app.db.models import RealtimeChange, RealtimeChangeKind, Score, ScoreMembership
from app.modules.realtime.stream_state import admit_stream_state
from app.utils.timezone import utc_now_naive

REALTIME_NOTIFY_CHANNEL = "realtime_changes"


def _unique_user_ids(user_ids: Iterable[int | None]) -> list[int]:
    return sorted({int(user_id) for user_id in user_ids if user_id is not None})


def _notify_change(db: Session, change: RealtimeChange) -> None:
    if db.get_bind().dialect.name != "postgresql":
        return
    db.execute(
        text("SELECT pg_notify(:channel, :payload)"),
        {
            "channel": REALTIME_NOTIFY_CHANNEL,
            "payload": json.dumps({"recipient_user_id": change.recipient_user_id}),
        },
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


def publish_change(
    db: Session,
    *,
    recipient_user_id: int,
    kind: RealtimeChangeKind,
    notification_id: str | None = None,
    score_id: str | None = None,
    revision_id: str | None = None,
    import_job_id: str | None = None,
) -> RealtimeChange:
    """Admit a change and transactional wake-up; the caller owns commit/rollback."""
    state = admit_stream_state(db, recipient_user_id)
    state.high_watermark_sequence += 1
    state.updated_at = utc_now_naive()
    change = RealtimeChange(
        recipient_user_id=recipient_user_id,
        sequence=state.high_watermark_sequence,
        kind=kind,
        notification_id=notification_id,
        score_id=score_id,
        revision_id=revision_id,
        import_job_id=import_job_id,
    )
    db.add(change)
    db.flush()
    _notify_change(db, change)
    return change


def publish_score_change(
    db: Session, *, score_id: str, revision_id: str, kind: RealtimeChangeKind
) -> None:
    # Every fan-out acquires recipient state locks in ascending order.
    for recipient_user_id in sorted(set(score_recipients(db, score_id))):
        publish_change(
            db,
            recipient_user_id=recipient_user_id,
            kind=kind,
            score_id=score_id,
            revision_id=revision_id,
        )
