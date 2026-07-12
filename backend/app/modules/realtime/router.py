from __future__ import annotations

import asyncio
import contextlib
import json
from datetime import datetime
from typing import Any, AsyncIterator

import asyncpg
from fastapi import APIRouter, Depends, Header, Request
from sqlalchemy import select
from starlette.responses import StreamingResponse

from app.api.deps import get_current_user
from app.core.config import settings
from app.db.model_utils import require_persisted_id
from app.db.session import AsyncSessionLocal
from app.db.models import RealtimeEvent, User
from app.modules.realtime.publisher import REALTIME_NOTIFY_CHANNEL
from app.modules.realtime.schemas import RealtimeEventRead

router = APIRouter()

EVENT_CATCHUP_INTERVAL_SECONDS = settings.REALTIME_EVENT_CATCHUP_INTERVAL_SECONDS
HEARTBEAT_INTERVAL_SECONDS = settings.REALTIME_EVENT_HEARTBEAT_INTERVAL_SECONDS
EVENT_BATCH_SIZE = settings.REALTIME_EVENT_BATCH_SIZE


def _json_default(value: object) -> str:
    if isinstance(value, datetime):
        return value.isoformat()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def _format_sse(event: RealtimeEvent) -> str:
    sequence = event.id or 0
    data = RealtimeEventRead(
        event_id=event.event_uuid,
        sequence=sequence,
        type=event.type,
        resource_type=event.resource_type,
        resource_id=event.resource_id,
        score_id=event.score_id,
        revision_id=event.revision_id,
        payload=event.payload,
        created_at=event.created_at,
    ).model_dump()
    return (
        f"id: {sequence}\n"
        f"event: {event.type}\n"
        f"data: {json.dumps(data, default=_json_default, separators=(',', ':'))}\n\n"
    )


def _parse_last_event_id(value: str | None) -> int:
    if not value:
        return 0
    try:
        return max(0, int(value))
    except ValueError:
        return 0


def _asyncpg_dsn() -> str:
    return settings.DATABASE_URL.replace("postgresql+asyncpg://", "postgresql://", 1)


async def _fetch_pending_events(user_id: int, last_sequence: int) -> list[RealtimeEvent]:
    async with AsyncSessionLocal() as db:
        return (
            await db.execute(
                select(RealtimeEvent)
                .where(
                    RealtimeEvent.recipient_user_id == user_id,
                    RealtimeEvent.id > last_sequence,
                )
                .order_by(RealtimeEvent.id.asc())
                .limit(EVENT_BATCH_SIZE)
            )
        ).scalars().all()


async def _emit_pending_events(user_id: int, last_sequence: int) -> tuple[int, list[str]]:
    messages: list[str] = []
    while True:
        rows = await _fetch_pending_events(user_id, last_sequence)
        if not rows:
            break
        for event in rows:
            if event.id is not None:
                last_sequence = event.id
            messages.append(_format_sse(event))
        if len(rows) < EVENT_BATCH_SIZE:
            break
    return last_sequence, messages


def _payload_matches_user(payload: str, user_id: int) -> bool:
    try:
        data = json.loads(payload)
    except json.JSONDecodeError:
        return True
    return data.get("recipient_user_id") == user_id


def _drain_queue(queue: asyncio.Queue[None]) -> None:
    while True:
        try:
            queue.get_nowait()
        except asyncio.QueueEmpty:
            return


async def _event_stream(
    request: Request,
    user_id: int,
    last_sequence: int,
) -> AsyncIterator[str]:
    queue: asyncio.Queue[None] = asyncio.Queue()

    def notify_listener(
        _connection: Any,
        _pid: int,
        _channel: str,
        payload: str,
    ) -> None:
        if _payload_matches_user(payload, user_id):
            queue.put_nowait(None)

    connection = await asyncpg.connect(dsn=_asyncpg_dsn())
    await connection.add_listener(REALTIME_NOTIFY_CHANNEL, notify_listener)
    try:
        seconds_since_heartbeat = 0
        yield ": connected\n\n"

        last_sequence, messages = await _emit_pending_events(user_id, last_sequence)
        for message in messages:
            yield message

        while not await request.is_disconnected():
            try:
                await asyncio.wait_for(queue.get(), timeout=EVENT_CATCHUP_INTERVAL_SECONDS)
            except asyncio.TimeoutError:
                seconds_since_heartbeat += EVENT_CATCHUP_INTERVAL_SECONDS
                if seconds_since_heartbeat >= HEARTBEAT_INTERVAL_SECONDS:
                    seconds_since_heartbeat = 0
                    yield ": heartbeat\n\n"
            else:
                seconds_since_heartbeat = 0

            _drain_queue(queue)
            last_sequence, messages = await _emit_pending_events(user_id, last_sequence)
            for message in messages:
                yield message
    finally:
        with contextlib.suppress(Exception):
            await connection.remove_listener(REALTIME_NOTIFY_CHANNEL, notify_listener)
        await connection.close()


@router.get("/events")
async def realtime_events(
    request: Request,
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    current_user: User = Depends(get_current_user),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    return StreamingResponse(
        _event_stream(request, user_id, _parse_last_event_id(last_event_id)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
