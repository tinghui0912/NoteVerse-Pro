"""Recipient-owned transaction locks synchronize publication, replay and retention."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from app.db.models import RealtimeStreamState
from app.shared.time import utc_now


def lock_stream_state(
    db: Session, recipient_user_id: int, *, read: bool = False
) -> RealtimeStreamState | None:
    return db.scalars(
        select(RealtimeStreamState)
        .where(RealtimeStreamState.recipient_user_id == recipient_user_id)
        .with_for_update(read=read)
        .execution_options(populate_existing=True)
    ).one_or_none()


def admit_stream_state(db: Session, recipient_user_id: int) -> RealtimeStreamState:
    insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
    db.execute(
        insert(RealtimeStreamState)
        .values(
            recipient_user_id=recipient_user_id,
            high_watermark_sequence=0,
            replay_floor_sequence=0,
            updated_at=utc_now(),
        )
        .on_conflict_do_nothing(index_elements=["recipient_user_id"])
    )
    state = lock_stream_state(db, recipient_user_id)
    assert state is not None
    return state
