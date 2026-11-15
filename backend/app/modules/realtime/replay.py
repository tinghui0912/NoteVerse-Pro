"""Bounded recipient replay with a durable retention floor."""

from dataclasses import dataclass
from typing import Literal
from sqlalchemy import select
from sqlalchemy.orm import Session
from app.db.models import RealtimeChange
from app.modules.realtime.generated.transport import (
    RealtimeChangeRead,
    change_read_adapter,
    ResyncReason,
)
from app.modules.realtime.stream_state import lock_stream_state

Cursor = int | Literal["invalid"] | None


@dataclass(frozen=True)
class ReplayPage:
    cursor: int
    changes: tuple[RealtimeChangeRead, ...] = ()
    reason: ResyncReason | None = None
    has_more: bool = False


def parse_cursor(value: str | None) -> Cursor:
    if value is None:
        return None
    if len(value) > 19 or not value.isascii() or not value.isdecimal():
        return "invalid"
    number = int(value)
    return number if number <= 9223372036854775807 else "invalid"


def read_page(db: Session, user_id: int, cursor: Cursor, *, limit: int) -> ReplayPage:
    state = lock_stream_state(db, user_id, read=True)
    high = state.high_watermark_sequence if state is not None else 0
    floor = state.replay_floor_sequence if state is not None else 0
    if cursor is None:
        return ReplayPage(high)
    if cursor == "invalid":
        return ReplayPage(high, reason="invalid_cursor")
    if cursor < floor:
        return ReplayPage(high, reason="retention_gap")
    if cursor > high:
        return ReplayPage(high, reason="cursor_out_of_range")
    if state is None:
        return ReplayPage(0)
    rows = db.scalars(
        select(RealtimeChange)
        .where(RealtimeChange.recipient_user_id == user_id, RealtimeChange.sequence > cursor)
        .order_by(RealtimeChange.sequence)
        .limit(limit)
    ).all()
    changes = []
    for row in rows:
        fields = dict(
            schemaVersion=1,
            sequence=row.sequence,
            changeId=row.change_uuid,
            kind=row.kind,
            createdAt=row.created_at,
        )
        if row.kind == "notifications.changed":
            fields["notificationId"] = row.notification_id
        elif row.kind == "import_jobs.changed":
            fields["importJobId"] = row.import_job_id
        else:
            fields.update(scoreId=row.score_id, revisionId=row.revision_id)
        changes.append(change_read_adapter.validate_python(fields))
    # A completed page advances only to this recipient's locked watermark.
    last = rows[-1].sequence if len(rows) == limit else high
    assert last is not None
    return ReplayPage(last, tuple(changes), has_more=len(rows) == limit)
