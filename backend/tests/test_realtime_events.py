from __future__ import annotations

import json
from collections.abc import Iterator

import pytest
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from app.db.models import RealtimeEvent, User
from app.db.models.user import UserRole
from app.modules.realtime.router import (
    _format_sse,
    _parse_last_event_id,
    _payload_matches_user,
    _pending_events_statement,
)
from app.modules.realtime.schemas import REALTIME_EVENT_SCHEMA_VERSION
from app.utils.timezone import utc_now_naive


@pytest.fixture
def realtime_session() -> Iterator[Session]:
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def enable_foreign_keys(dbapi_connection, _connection_record) -> None:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SQLModel.metadata.create_all(engine)
    with Session(engine) as session:
        session.add_all(
            [
                User(
                    id=7,
                    email="user-7@example.com",
                    display_name="User 7",
                    password_hash="hash",
                    role=UserRole.user,
                ),
                User(
                    id=8,
                    email="user-8@example.com",
                    display_name="User 8",
                    password_hash="hash",
                    role=UserRole.user,
                ),
            ]
        )
        session.commit()
        yield session
    engine.dispose()


def _event() -> RealtimeEvent:
    return RealtimeEvent(
        id=42,
        event_uuid="event-42",
        recipient_user_id=7,
        type="score.derived_asset.updated",
        resource_type="score",
        resource_id="score-1",
        score_id="score-1",
        revision_id="revision-1",
        payload={"asset": "preview", "status": "ready"},
        created_at=utc_now_naive(),
    )


def test_realtime_sse_envelope_is_versioned() -> None:
    message = _format_sse(_event())
    lines = message.strip().splitlines()

    assert lines[0] == "id: 42"
    assert lines[1] == "event: score.derived_asset.updated"

    data = json.loads(lines[2].removeprefix("data: "))
    assert data["schema_version"] == REALTIME_EVENT_SCHEMA_VERSION
    assert data["event_id"] == "event-42"
    assert data["sequence"] == 42
    assert data["score_id"] == "score-1"
    assert data["revision_id"] == "revision-1"
    assert data["payload"] == {}


def test_last_event_id_parsing_is_safe() -> None:
    assert _parse_last_event_id(None) == 0
    assert _parse_last_event_id("") == 0
    assert _parse_last_event_id("41") == 41
    assert _parse_last_event_id("-1") == 0
    assert _parse_last_event_id("not-a-number") == 0


def test_notify_payload_filters_to_matching_user() -> None:
    assert _payload_matches_user('{"recipient_user_id":7}', 7) is True
    assert _payload_matches_user('{"recipient_user_id":8}', 7) is False
    assert _payload_matches_user("not-json", 7) is True


def test_pending_events_statement_is_user_scoped_and_sequence_scoped(
    realtime_session: Session,
) -> None:
    realtime_session.add_all(
        [
            RealtimeEvent(
                id=10,
                event_uuid="event-10",
                recipient_user_id=7,
                type="notification.created",
                payload={"label": "already-seen"},
            ),
            RealtimeEvent(
                id=11,
                event_uuid="event-11",
                recipient_user_id=8,
                type="notification.created",
                payload={"label": "other-user"},
            ),
            RealtimeEvent(
                id=12,
                event_uuid="event-12",
                recipient_user_id=7,
                type="score.metadata.updated",
                payload={"label": "current-user"},
            ),
            RealtimeEvent(
                id=13,
                event_uuid="event-13",
                recipient_user_id=7,
                type="score.derived_asset.updated",
                payload={"label": "current-user-later"},
            ),
        ]
    )
    realtime_session.commit()

    events = realtime_session.execute(
        _pending_events_statement(user_id=7, last_sequence=10)
    ).scalars().all()

    assert [event.id for event in events] == [12, 13]
    assert [event.recipient_user_id for event in events] == [7, 7]
