from __future__ import annotations

import json
import asyncio
from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy import event
from sqlmodel import Session, SQLModel, create_engine

from app.db.models import RealtimeEvent, User
from app.modules.realtime.router import (
    _format_sse,
    _parse_last_event_id,
    _payload_matches_user,
    _pending_events_statement,
)
from app.modules.realtime.schemas import REALTIME_EVENT_SCHEMA_VERSION
from app.utils.timezone import utc_now_naive


@pytest.mark.asyncio
async def test_postgresql_listener_wakes_the_stream_and_closes_its_connection(monkeypatch):
    import psycopg
    from sqlalchemy import text
    from app.db.session import engine
    from app.modules.realtime import router as stream_router

    if not (engine.url.database or "").startswith("noteverse_test_"):
        pytest.skip("A dedicated application PostgreSQL test database is required")
    connections = []
    connect = psycopg.AsyncConnection.connect

    async def open_connection(*args, **kwargs):
        connection = await connect(*args, **kwargs)
        connections.append(connection)
        return connection

    monkeypatch.setattr(
        stream_router,
        "psycopg",
        SimpleNamespace(AsyncConnection=SimpleNamespace(connect=open_connection)),
    )
    ready = asyncio.Event()
    deliveries = 0

    async def pending(user_id, sequence):
        nonlocal deliveries
        assert user_id == 7
        deliveries += 1
        ready.set()
        return (sequence, []) if deliveries == 1 else (42, ["event: accepted\n\n"])

    monkeypatch.setattr(stream_router, "_emit_pending_events", pending)
    request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
    stream = stream_router._event_stream(request, 7, 0)
    message = None
    try:
        assert await anext(stream) == ": connected\n\n"
        message = asyncio.create_task(anext(stream))
        await asyncio.wait_for(ready.wait(), 5)
        async with engine.begin() as connection:
            await connection.execute(
                text("SELECT pg_notify(:channel, :payload)"),
                {
                    "channel": stream_router.REALTIME_NOTIFY_CHANNEL,
                    "payload": '{"recipient_user_id":7}',
                },
            )
        assert await asyncio.wait_for(message, 5) == "event: accepted\n\n"
    finally:
        if message is not None and not message.done():
            message.cancel()
            try:
                await message
            except asyncio.CancelledError:
                pass
        await stream.aclose()
        await engine.dispose()
    assert len(connections) == 1 and connections[0].closed


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
                ),
                User(
                    id=8,
                    email="user-8@example.com",
                    display_name="User 8",
                    password_hash="hash",
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
    assert "resource_type" not in data
    assert "resource_id" not in data
    assert data["score_id"] == "score-1"
    assert data["revision_id"] == "revision-1"
    assert data["payload"] == {}


def test_realtime_sse_payload_is_not_public_api_detail() -> None:
    event = RealtimeEvent(
        id=43,
        event_uuid="event-43",
        recipient_user_id=7,
        type="import_job.completed",
        resource_type="job",
        resource_id="job-1",
        payload={
            "job_id": "job-1",
            "job_title": "Imported score",
            "notification_id": "notification-1",
            "internal_reason": "worker recovered stale delivery",
        },
        created_at=utc_now_naive(),
    )

    message = _format_sse(event)
    data = json.loads(message.strip().splitlines()[2].removeprefix("data: "))

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

    events = (
        realtime_session.execute(_pending_events_statement(user_id=7, last_sequence=10))
        .scalars()
        .all()
    )

    assert [event.id for event in events] == [12, 13]
    assert [event.recipient_user_id for event in events] == [7, 7]
