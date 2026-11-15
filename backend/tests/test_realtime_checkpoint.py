"""Recipient checkpoints bridge baseline, reconnect and durable page replay."""

import asyncio
import json
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from sqlalchemy.orm import Session

from app.modules.realtime import router
from app.modules.realtime.wakeup import RealtimeWakeupHub
from tests.test_realtime_changes import realtime_session as realtime_session, change


def payload(message):
    return json.loads(next(line[6:] for line in message.splitlines() if line.startswith("data: ")))


def request(hub):
    return SimpleNamespace(
        is_disconnected=AsyncMock(return_value=False),
        state=SimpleNamespace(realtime_wakeup_hub=hub),
    )


@pytest.fixture
def streams(realtime_session, monkeypatch):
    hub = RealtimeWakeupHub(enabled=False)
    bind = realtime_session.get_bind()
    monkeypatch.setattr(router, "SessionLocal", lambda: Session(bind))
    monkeypatch.setattr(router, "EVENT_CATCHUP_INTERVAL_SECONDS", 0.01)
    monkeypatch.setattr(router, "HEARTBEAT_INTERVAL_SECONDS", 100)
    monkeypatch.setattr(router, "CHANGE_BATCH_SIZE", 2)
    return realtime_session, hub


@pytest.mark.asyncio
async def test_fresh_checkpoint_resumes_changes_committed_before_the_first_live_event(streams):
    db, hub = streams
    for _ in range(10):
        change(db)
    db.commit()
    stream = router._event_stream(request(hub), 7, None)
    checkpoint = await anext(stream)
    assert checkpoint.startswith("id: 10\nevent: checkpoint\n")
    assert payload(checkpoint) == {"schemaVersion": 1, "sequence": 10}
    await stream.aclose()
    change(db)
    db.commit()
    reconnect = router._event_stream(request(hub), 7, 10)
    try:
        message = await anext(reconnect)
        assert message.startswith("id: 11\nevent: change\n")
        assert payload(message)["sequence"] == 11
        assert (await anext(reconnect)).startswith("id: 11\nevent: checkpoint\n")
    finally:
        await reconnect.aclose()


@pytest.mark.asyncio
async def test_empty_recipient_receives_a_zero_checkpoint_after_subscription(streams, monkeypatch):
    db, hub = streams
    change(db, 8)
    db.commit()
    original = router._fetch_page

    def fetch(user_id, cursor):
        assert user_id in hub._subscribers
        return original(user_id, cursor)

    monkeypatch.setattr(router, "_fetch_page", fetch)
    stream = router._event_stream(request(hub), 7, None)
    assert payload(await anext(stream)) == {"schemaVersion": 1, "sequence": 0}
    await stream.aclose()
    assert hub._subscribers == {}


@pytest.mark.asyncio
async def test_baseline_includes_commits_before_its_read(streams):
    db, hub = streams
    stream = router._event_stream(request(hub), 7, None)
    change(db)
    db.commit()
    assert payload(await anext(stream))["sequence"] == 1
    await stream.aclose()


@pytest.mark.asyncio
async def test_wake_after_baseline_read_is_retained_for_live_replay(streams, monkeypatch):
    db, hub = streams
    monkeypatch.setattr(router, "EVENT_CATCHUP_INTERVAL_SECONDS", 60)
    original = router._replay_pages

    async def pages(user_id, cursor):
        async for page in original(user_id, cursor):
            if cursor is None:
                change(db)
                db.commit()
                hub.notify('{"recipient_user_id":7}')
            yield page

    monkeypatch.setattr(router, "_replay_pages", pages)
    stream = router._event_stream(request(hub), 7, None)
    try:
        assert payload(await anext(stream))["sequence"] == 0
        assert hub._subscribers[7] and all(event.is_set() for event in hub._subscribers[7])
        assert (await asyncio.wait_for(anext(stream), 1)).startswith("id: 1\nevent: change\n")
    finally:
        await stream.aclose()


@pytest.mark.asyncio
async def test_reconnect_mid_page_continues_after_the_last_delivered_id(streams):
    db, hub = streams
    for _ in range(5):
        change(db)
    db.commit()
    stream = router._event_stream(request(hub), 7, 0)
    assert payload(await anext(stream))["sequence"] == 1
    await stream.aclose()
    reconnect = router._event_stream(request(hub), 7, 1)
    try:
        received = [payload(await anext(reconnect))["sequence"] for _ in range(4)]
        assert received == [2, 3, 4, 5]
        assert (await anext(reconnect)).startswith("id: 5\nevent: checkpoint\n")
    finally:
        await reconnect.aclose()


@pytest.mark.asyncio
async def test_polling_replays_committed_changes_without_any_notification(streams):
    db, hub = streams
    stream = router._event_stream(request(hub), 7, None)
    try:
        await anext(stream)
        change(db)
        db.commit()
        assert (await asyncio.wait_for(anext(stream), 1)).startswith("id: 1\nevent: change\n")
    finally:
        await stream.aclose()


@pytest.mark.asyncio
async def test_wake_arriving_during_replay_remains_set_for_the_next_replay(streams, monkeypatch):
    db, hub = streams
    monkeypatch.setattr(router, "EVENT_CATCHUP_INTERVAL_SECONDS", 60)
    original = router._replay_pages
    inserted = False

    async def pages(user_id, cursor):
        nonlocal inserted
        async for page in original(user_id, cursor):
            if cursor == 0 and not inserted:
                inserted = True
                change(db)
                db.commit()
                hub.notify('{"recipient_user_id":7}')
            yield page

    monkeypatch.setattr(router, "_replay_pages", pages)
    stream = router._event_stream(request(hub), 7, None)
    try:
        await anext(stream)
        hub.notify('{"recipient_user_id":7}')
        # Replay read high=0, then change 1 commits and sets a new signal.
        assert (await asyncio.wait_for(anext(stream), 1)).startswith("id: 1\nevent: change\n")
    finally:
        await stream.aclose()
