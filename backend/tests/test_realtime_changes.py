"""Versioned changes, explicit cursors and short off-loop replay Sessions."""

import asyncio
import json
import threading
from collections.abc import Iterator
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from sqlalchemy import event
from sqlalchemy.pool import StaticPool
from sqlalchemy.orm import Session
from sqlmodel import SQLModel, create_engine
from app.db.models import User, RealtimeStreamState
from app.modules.realtime.router import _format_sse, _payload_matches_user
from app.modules.realtime.replay import parse_cursor, read_page
from app.modules.realtime.schemas import change_read_adapter
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
        from app.modules.realtime.replay import ReplayPage
        from app.modules.realtime.schemas import change_read_adapter

        nonlocal deliveries
        assert user_id == 7
        deliveries += 1
        ready.set()
        yield (
            ReplayPage(sequence)
            if deliveries == 1
            else ReplayPage(
                42,
                (
                    change_read_adapter.validate_python(
                        {
                            "sequence": 42,
                            "changeId": "change",
                            "createdAt": utc_now_naive(),
                            "kind": "import_jobs.changed",
                            "importJobId": "job",
                        }
                    ),
                ),
            )
        )

    monkeypatch.setattr(stream_router, "_replay_pages", pending)
    request = SimpleNamespace(is_disconnected=AsyncMock(return_value=False))
    stream = stream_router._event_stream(request, 7, 0)
    message = None
    try:
        assert await anext(stream) == ": connected\n\n"
        message = asyncio.create_task(anext(stream))
        await asyncio.wait_for(ready.wait(), 5)
        with engine.begin() as connection:
            connection.execute(
                text("SELECT pg_notify(:channel, :payload)"),
                {
                    "channel": stream_router.REALTIME_NOTIFY_CHANNEL,
                    "payload": '{"recipient_user_id":7}',
                },
            )
        assert "event: change\n" in await asyncio.wait_for(message, 5)
    finally:
        if message is not None and not message.done():
            message.cancel()
            try:
                await message
            except asyncio.CancelledError:
                pass
        await stream.aclose()
        engine.dispose()
    assert len(connections) == 1 and connections[0].closed


@pytest.fixture
def realtime_session() -> Iterator[Session]:
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool
    )

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


def change(db, recipient=7):
    from app.modules.realtime.publisher import publish_change
    from app.db.models import RealtimeChangeKind

    return publish_change(
        db,
        recipient_user_id=recipient,
        kind=RealtimeChangeKind.SCORE_METADATA_CHANGED,
        score_id="score",
        revision_id="revision",
    )


def test_change_sse_envelope_has_sequence_and_typed_resource_identity():
    data = change_read_adapter.validate_python(
        dict(
            sequence=42,
            changeId="change-42",
            kind="score.derived_assets.changed",
            scoreId="score",
            revisionId="revision",
            createdAt=utc_now_naive(),
        )
    )
    lines = _format_sse(data).strip().splitlines()
    assert lines[:2] == ["id: 42", "event: change"]
    assert json.loads(lines[2].removeprefix("data: ")) == dict(
        schemaVersion=1,
        sequence=42,
        changeId="change-42",
        kind="score.derived_assets.changed",
        scoreId="score",
        revisionId="revision",
        createdAt=data.model_dump(mode="json")["createdAt"],
    )


@pytest.mark.parametrize(
    "value,expected",
    [
        (None, None),
        ("0", 0),
        ("41", 41),
        ("", "invalid"),
        ("-1", "invalid"),
        ("not-a-number", "invalid"),
        ("1.5", "invalid"),
        ("9223372036854775808", "invalid"),
    ],
)
def test_cursor_parsing_distinguishes_fresh_replay_and_invalid(value, expected):
    assert parse_cursor(value) == expected


def test_wake_up_routing_matches_recipient():
    assert _payload_matches_user('{"recipient_user_id":7}', 7)
    assert not _payload_matches_user('{"recipient_user_id":8}', 7)
    assert _payload_matches_user("not-json", 7)


def test_fresh_baseline_and_recipient_gap_replay(realtime_session):
    db = realtime_session
    change(db)
    change(db, 8)
    change(db)
    change(db)
    db.commit()
    fresh = read_page(db, 7, None, limit=2)
    assert fresh.cursor == 3 and fresh.changes == () and fresh.reason is None
    first = read_page(db, 7, 0, limit=2)
    assert [row.sequence for row in first.changes] == [1, 2] and first.has_more
    second = read_page(db, 7, first.cursor, limit=2)
    assert [row.sequence for row in second.changes] == [3] and second.cursor == 3
    change(db)
    db.commit()
    assert [row.sequence for row in read_page(db, 7, fresh.cursor, limit=2).changes] == [4]


@pytest.mark.parametrize(
    "cursor,reason",
    [(0, "retention_gap"), (9, "cursor_out_of_range"), ("invalid", "invalid_cursor")],
)
def test_unreplayable_cursor_resets_once_to_the_high_watermark(realtime_session, cursor, reason):
    db = realtime_session
    for _ in range(4):
        change(db)
    db.get(RealtimeStreamState, 7).replay_floor_sequence = 3
    db.commit()
    page = read_page(db, 7, cursor, limit=2)
    assert page.cursor == 4 and page.reason == reason and page.changes == ()
    assert read_page(db, 7, page.cursor, limit=2).reason is None


@pytest.mark.asyncio
async def test_replay_reads_bounded_pages_in_short_off_loop_sessions(realtime_session, monkeypatch):
    from app.modules.realtime import router

    for recipient in (7, 8, 7, 7, 7, 7):
        change(realtime_session, recipient)
    realtime_session.commit()
    bind = realtime_session.get_bind()
    opened, closed, threads = [], [], []

    class CatchupSession(Session):
        def __enter__(self):
            opened.append(self)
            threads.append(threading.get_ident())
            return super().__enter__()

        def __exit__(self, *args):
            try:
                return super().__exit__(*args)
            finally:
                closed.append(self)

    monkeypatch.setattr(router, "CHANGE_BATCH_SIZE", 2)
    monkeypatch.setattr(router, "SessionLocal", lambda: CatchupSession(bind))
    pages = [page async for page in router._replay_pages(7, 1)]
    assert pages[-1].cursor == 5
    assert [[change.sequence for change in page.changes] for page in pages] == [[2, 3], [4, 5], []]
    assert len(opened) == 3 and closed == opened
    assert all(thread != threading.get_ident() for thread in threads)
    idle = [page async for page in router._replay_pages(7, 5)]
    assert len(idle) == 1 and idle[0].changes == ()


@pytest.mark.asyncio
async def test_fresh_stream_installs_listen_before_reading_its_baseline(monkeypatch):
    from app.modules.realtime import router

    order = []

    class Connection:
        async def execute(self, _statement):
            order.append("listen")

        async def close(self):
            order.append("closed")

        async def notifies(self):
            await asyncio.Event().wait()
            yield None

    async def connect(*args, **kwargs):
        return Connection()

    def fetch(user_id, cursor):
        from app.modules.realtime.replay import ReplayPage

        assert cursor is None and order == ["listen"]
        order.append("baseline")
        return ReplayPage(10)

    monkeypatch.setattr(
        router, "psycopg", SimpleNamespace(AsyncConnection=SimpleNamespace(connect=connect))
    )
    monkeypatch.setattr(router, "_fetch_page", fetch)
    stream = router._event_stream(
        SimpleNamespace(is_disconnected=AsyncMock(return_value=True)), 7, None
    )
    assert await anext(stream) == ": connected\n\n"
    with pytest.raises(StopAsyncIteration):
        await anext(stream)
    assert order == ["listen", "baseline", "closed"]


def test_sse_authentication_releases_its_session_before_streaming(realtime_session, monkeypatch):
    from fastapi.testclient import TestClient
    from app.main import create_app
    from app.core.security import create_access_token
    from app.core.generated.customer_browser_protocol import AUTH_COOKIE_NAME
    from app.db import session as database
    from app.modules.realtime import router as stream_router

    bind = realtime_session.get_bind()
    opened, closed = [], []

    class AuthenticationSession(Session):
        def __enter__(self):
            opened.append(self)
            return super().__enter__()

        def __exit__(self, *args):
            try:
                return super().__exit__(*args)
            finally:
                closed.append(self)

    def sessions():
        return AuthenticationSession(bind)

    async def events(request, user_id, last_sequence):
        assert user_id == 7 and last_sequence == 12
        assert len(opened) == 1 and closed == opened
        yield ": authenticated\n\n"

    monkeypatch.setattr(database, "SessionLocal", sessions)
    monkeypatch.setattr(stream_router, "_event_stream", events)
    application = create_app()
    with TestClient(application) as client:
        client.cookies.set(AUTH_COOKIE_NAME, create_access_token("7"))
        response = client.get("/api/v1/realtime/events", headers={"Last-Event-ID": "12"})
    assert response.status_code == 200
    assert response.content == b": authenticated\n\n"
    assert len(opened) == 1 and closed == opened


@pytest.mark.asyncio
@pytest.mark.parametrize("reason", ["retention_gap", "cursor_out_of_range", "invalid_cursor"])
async def test_resync_control_advances_cursor_then_keeps_the_same_stream_live(monkeypatch, reason):
    from app.modules.realtime import router
    from app.modules.realtime.replay import ReplayPage

    calls = []

    class Connection:
        async def execute(self, statement):
            pass

        async def close(self):
            pass

        async def notifies(self):
            await asyncio.Event().wait()
            yield None

    async def connect(*args, **kwargs):
        return Connection()

    def fetch(user_id, cursor):
        calls.append(cursor)
        if len(calls) == 1:
            return ReplayPage(42, reason=reason)
        change = change_read_adapter.validate_python(
            dict(
                sequence=43,
                changeId="live",
                kind="import_jobs.changed",
                importJobId="job",
                createdAt=utc_now_naive(),
            )
        )
        return ReplayPage(43, (change,))

    async def wake(awaitable, **kwargs):
        awaitable.close()
        return None

    monkeypatch.setattr(
        router, "psycopg", SimpleNamespace(AsyncConnection=SimpleNamespace(connect=connect))
    )
    monkeypatch.setattr(router, "_fetch_page", fetch)
    monkeypatch.setattr(router.asyncio, "wait_for", wake)
    stream = router._event_stream(
        SimpleNamespace(is_disconnected=AsyncMock(return_value=False)), 7, 0
    )
    try:
        assert await anext(stream) == ": connected\n\n"
        control = (await anext(stream)).strip().splitlines()
        assert control[:2] == ["id: 42", "event: resync-required"]
        assert json.loads(control[2].removeprefix("data: ")) == {
            "schemaVersion": 1,
            "sequence": 42,
            "reason": reason,
        }
        live = await anext(stream)
        assert live.startswith("id: 43\nevent: change\n")
        assert calls == [0, 42]
    finally:
        await stream.aclose()


def test_recipient_without_activity_has_an_empty_stream_without_creating_state(realtime_session):
    from sqlalchemy import select

    db = realtime_session
    assert read_page(db, 7, None, limit=10).cursor == 0
    assert read_page(db, 7, 0, limit=10).changes == ()
    assert read_page(db, 7, 1, limit=10).reason == "cursor_out_of_range"
    assert db.scalar(select(RealtimeStreamState)) is None
    change(db, 8)
    db.commit()
    assert read_page(db, 7, None, limit=10).cursor == 0
    assert db.get(RealtimeStreamState, 7) is None
    db.commit()
    change(db, 7)
    db.commit()
    assert [row.sequence for row in read_page(db, 7, 0, limit=10).changes] == [1]
