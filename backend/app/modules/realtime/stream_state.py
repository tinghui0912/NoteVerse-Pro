"""Short transaction locks synchronize change admission, replay and retention."""

from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.dialects.sqlite import insert as sqlite_insert
from app.db.models import RealtimeStreamState
from app.utils.timezone import utc_now_naive


def lock_stream_state(db: Session, *, read: bool = False) -> RealtimeStreamState:
    # The baseline seeds the singleton. Isolated metadata-created databases use
    # the same initial state, installed atomically before taking its row lock.
    if db.get(RealtimeStreamState, 1) is None:
        insert = pg_insert if db.get_bind().dialect.name == "postgresql" else sqlite_insert
        db.execute(
            insert(RealtimeStreamState)
            .values(id=1, replay_floor_sequence=0, updated_at=utc_now_naive())
            .on_conflict_do_nothing(index_elements=["id"])
        )
    return db.scalars(
        select(RealtimeStreamState)
        .where(RealtimeStreamState.id == 1)
        .with_for_update(read=read)
        .execution_options(populate_existing=True)
    ).one()
