"""Coalesced recipient wakeups and process-owned LISTEN lifetime."""

import asyncio
from types import SimpleNamespace

import pytest

from app.modules.realtime.wakeup import RealtimeWakeupHub
from tests.test_realtime_changes import realtime_session as realtime_session, change


class Connection:
    def __init__(self):
        self.messages = asyncio.Queue()
        self.closed = False
        self.statements = []

    async def execute(self, statement):
        self.statements.append(str(statement))

    async def close(self):
        self.closed = True

    async def notifies(self):
        while True:
            message = await self.messages.get()
            if isinstance(message, Exception):
                raise message
            yield SimpleNamespace(payload=message)


def test_all_tabs_for_a_recipient_receive_coalesced_scoped_wakes():
    hub = RealtimeWakeupHub(enabled=False)
    with hub.subscribe(1) as first, hub.subscribe(1) as second, hub.subscribe(2) as other:
        for _ in range(100):
            hub.notify('{"recipient_user_id":1}')
        assert first.is_set() and second.is_set() and not other.is_set()
        first.clear()
        assert not first.is_set() and second.is_set()
        for payload in ["invalid", "{}", '{"recipient_user_id":true}', '{"recipient_user_id":"1"}']:
            hub.notify(payload)
        assert not first.is_set()
    assert hub._subscribers == {}


@pytest.mark.asyncio
async def test_many_subscriptions_share_one_listener_and_shutdown_closes_it():
    connections = []

    async def connect():
        connection = Connection()
        connections.append(connection)
        return connection

    hub = RealtimeWakeupHub(connect=connect, enabled=True)
    await hub.start()
    try:
        await asyncio.wait_for(hub.listening.wait(), 1)
        await hub.start()
        with hub.subscribe(1) as first, hub.subscribe(1) as second, hub.subscribe(2) as other:
            await connections[0].messages.put('{"recipient_user_id":1}')
            await asyncio.wait_for(asyncio.gather(first.wait(), second.wait()), 1)
            assert not other.is_set()
        assert len(connections) == 1 and len(connections[0].statements) == 1
    finally:
        await hub.stop()
    assert connections[0].closed and hub._task is None


@pytest.mark.asyncio
async def test_many_sse_streams_share_the_process_listener(monkeypatch):
    from app.modules.realtime import router
    from app.modules.realtime.replay import ReplayPage

    opened = []

    async def connect():
        connection = Connection()
        opened.append(connection)
        return connection

    hub = RealtimeWakeupHub(connect=connect, enabled=True)
    monkeypatch.setattr(router, "_fetch_page", lambda *_: ReplayPage(0))
    request = SimpleNamespace(
        is_disconnected=lambda: None, state=SimpleNamespace(realtime_wakeup_hub=hub)
    )
    streams = [router._event_stream(request, 1, None) for _ in range(30)]
    await hub.start()
    try:
        await asyncio.wait_for(hub.listening.wait(), 1)
        messages = await asyncio.gather(*(anext(stream) for stream in streams))
        assert all("event: checkpoint" in message for message in messages)
        assert len(opened) == 1 and len(hub._subscribers[1]) == 30
    finally:
        for stream in streams:
            await stream.aclose()
        await hub.stop()
    assert not hub._subscribers and opened[0].closed


@pytest.mark.asyncio
async def test_listener_reconnects_and_keeps_existing_subscribers():
    connections = []

    async def connect():
        connection = Connection()
        connections.append(connection)
        if len(connections) == 1:
            await connection.messages.put(OSError("connection lost"))
        return connection

    hub = RealtimeWakeupHub(connect=connect, enabled=True, reconnect_seconds=0)
    with hub.subscribe(1) as signal:
        await hub.start()
        try:

            async def reconnect():
                while len(connections) < 2 or not hub.listening.is_set():
                    await asyncio.sleep(0)

            await asyncio.wait_for(reconnect(), 1)
            await connections[1].messages.put('{"recipient_user_id":1}')
            await asyncio.wait_for(signal.wait(), 1)
        finally:
            await hub.stop()
    assert len(connections) == 2 and all(c.closed for c in connections)


@pytest.mark.asyncio
async def test_non_postgresql_runtime_keeps_the_listener_inactive(monkeypatch):
    from app.modules.realtime import wakeup

    monkeypatch.setattr(wakeup, "engine", SimpleNamespace(dialect=SimpleNamespace(name="sqlite")))

    async def connect():
        raise AssertionError("No LISTEN is configured")

    hub = RealtimeWakeupHub(connect=connect)
    await hub.start()
    assert hub._task is None
    await hub.stop()


@pytest.mark.asyncio
async def test_only_api_lifespan_owns_the_process_hub(monkeypatch):
    from unittest.mock import AsyncMock
    from app.core.lifespan import create_app_lifespan
    from app.core.runtime_checks import RuntimeRole
    from app.modules.realtime import wakeup
    from app.core import lifespan

    hub = SimpleNamespace(start=AsyncMock(), stop=AsyncMock())
    monkeypatch.setattr(wakeup, "RealtimeWakeupHub", lambda: hub)
    monkeypatch.setattr(lifespan, "ensure_runtime_directories", lambda: None)
    monkeypatch.setattr(lifespan, "log_external_tool_status", lambda role: None)
    for role in [RuntimeRole.API, RuntimeRole.CONTROL_PLANE, RuntimeRole.OBSERVABILITY_EXPORTER]:
        async with create_app_lifespan(role)(SimpleNamespace()) as state:
            assert state == ({"realtime_wakeup_hub": hub} if role is RuntimeRole.API else {})
    hub.start.assert_awaited_once()
    hub.stop.assert_awaited_once()


def test_api_lifespan_keeps_request_wakeup_state_with_its_own_event_loop(monkeypatch):
    from fastapi import FastAPI, Request
    from fastapi.testclient import TestClient
    from app.core import lifespan
    from app.core.runtime_checks import RuntimeRole
    from app.modules.realtime import wakeup

    hubs = []

    async def connect():
        return Connection()

    def hub():
        instance = RealtimeWakeupHub(connect=connect, enabled=True)
        hubs.append(instance)
        return instance

    monkeypatch.setattr(wakeup, "RealtimeWakeupHub", hub)
    monkeypatch.setattr(lifespan, "ensure_runtime_directories", lambda: None)
    monkeypatch.setattr(lifespan, "log_external_tool_status", lambda role: None)
    app = FastAPI(lifespan=lifespan.create_app_lifespan(RuntimeRole.API))

    @app.get("/hub")
    def identity(request: Request):
        return {"identity": id(request.state.realtime_wakeup_hub)}

    with TestClient(app) as first:
        first_id = first.get("/hub").json()
        with TestClient(app) as second:
            assert second.get("/hub").json() != first_id
            assert first.get("/hub").json() == first_id
        assert hubs[1]._task is None and hubs[0]._task is not None
        assert first.get("/hub").json() == first_id
    assert len(hubs) == 2 and all(instance._task is None for instance in hubs)


@pytest.mark.asyncio
async def test_postgresql_commit_wakes_the_process_and_rollback_does_not(realtime_session):
    import psycopg
    from sqlalchemy import select
    from app.db.models import RealtimeChange, RealtimeStreamState

    engine = realtime_session.get_bind()
    assert (engine.url.database or "").startswith("noteverse_test_")
    opened = []

    async def connect():
        args, kwargs = engine.dialect.create_connect_args(engine.url)
        connection = await psycopg.AsyncConnection.connect(*args, **kwargs, autocommit=True)
        opened.append(connection)
        return connection

    hub = RealtimeWakeupHub(enabled=True, connect=connect)
    await hub.start()
    try:
        await asyncio.wait_for(hub.listening.wait(), 5)
        with hub.subscribe(7) as first, hub.subscribe(7) as second, hub.subscribe(8) as other:
            change(realtime_session)
            realtime_session.rollback()
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(first.wait(), 0.05)
            assert realtime_session.scalar(select(RealtimeChange)) is None
            assert realtime_session.get(RealtimeStreamState, 7) is None
            change(realtime_session)
            realtime_session.commit()
            await asyncio.wait_for(asyncio.gather(first.wait(), second.wait()), 5)
            assert not other.is_set() and len(opened) == 1
            assert realtime_session.scalar(select(RealtimeChange)).sequence == 1
    finally:
        await hub.stop()
    assert opened[0].closed
