from app.core.exceptions import AuthenticationException


import asyncio
from typing import AsyncIterator

from fastapi import APIRouter, Depends, Header, Request
from starlette.responses import StreamingResponse

from app.runtime.customer_api.deps import get_current_user
from app.core.metrics import realtime_connection_closed, realtime_connection_opened
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.realtime.generated.transport import (
    RealtimeChangeRead,
    RealtimeCheckpointRead,
    RealtimeResyncRequiredRead,
)
from app.modules.realtime.replay import Cursor, ReplayPage, parse_cursor, read_page

router = APIRouter()


def _format_sse(change: RealtimeChangeRead) -> str:
    return f"id: {change.sequence}\nevent: change\ndata: {change.model_dump_json()}\n\n"


def _format_resync(control: RealtimeResyncRequiredRead) -> str:
    return f"id: {control.sequence}\nevent: resync-required\ndata: {control.model_dump_json()}\n\n"


def _fetch_page(request: Request, user_id: int, cursor: Cursor) -> ReplayPage:
    with request.app.state.session_factory() as db:
        from app.runtime.customer_api.auth_services import get_session_service
        from app.runtime.customer_api.deps import session_token

        token = session_token(request)
        if token is None:
            from app.core.exceptions import AuthenticationException

            raise AuthenticationException()
        user, _ = get_session_service(request).authenticate(db, token)
        if user.id != user_id:
            raise RuntimeError("Realtime principal changed")
        return read_page(
            db, user_id, cursor, limit=request.app.state.settings.REALTIME_EVENT_BATCH_SIZE
        )


async def _replay_pages(
    request: Request, user_id: int, cursor: Cursor
) -> AsyncIterator[ReplayPage]:
    while True:
        page = await asyncio.to_thread(_fetch_page, request, user_id, cursor)
        yield page
        cursor = page.cursor
        if not page.has_more:
            return


def _page_messages(page: ReplayPage) -> list[str]:
    if page.reason is not None:
        return [
            _format_resync(
                RealtimeResyncRequiredRead(
                    schemaVersion=1, sequence=page.cursor, reason=page.reason
                )
            )
        ]
    return [_format_sse(change) for change in page.changes]


def _format_checkpoint(control: RealtimeCheckpointRead) -> str:
    return f"id: {control.sequence}\nevent: checkpoint\ndata: {control.model_dump_json()}\n\n"


async def _event_stream(
    request: Request, user_id: int, last_sequence: Cursor
) -> AsyncIterator[str]:
    realtime_connection_opened(channel="app_sse")
    try:
        with request.state.realtime_wakeup_hub.subscribe(user_id) as signal:
            async for page in _replay_pages(request, user_id, last_sequence):
                last_sequence = page.cursor
                for message in _page_messages(page):
                    yield message
            assert isinstance(last_sequence, int)
            yield _format_checkpoint(
                RealtimeCheckpointRead(schemaVersion=1, sequence=last_sequence)
            )
            seconds_since_heartbeat = 0
            while not await request.is_disconnected():
                try:
                    await asyncio.wait_for(
                        signal.wait(),
                        timeout=request.app.state.settings.REALTIME_EVENT_CATCHUP_INTERVAL_SECONDS,
                    )
                except asyncio.TimeoutError:
                    seconds_since_heartbeat += (
                        request.app.state.settings.REALTIME_EVENT_CATCHUP_INTERVAL_SECONDS
                    )
                    if (
                        seconds_since_heartbeat
                        >= request.app.state.settings.REALTIME_EVENT_HEARTBEAT_INTERVAL_SECONDS
                    ):
                        seconds_since_heartbeat = 0
                        yield ": heartbeat\n\n"
                else:
                    seconds_since_heartbeat = 0
                signal.clear()
                async for page in _replay_pages(request, user_id, last_sequence):
                    last_sequence = page.cursor
                    for message in _page_messages(page):
                        yield message
    except AuthenticationException:
        return
    finally:
        realtime_connection_closed(channel="app_sse")


@router.get(
    "/events",
    operation_id="realtimeEventsStream",
    response_class=StreamingResponse,
    responses={
        200: {
            "description": "Versioned change delivery and resync-required controls with sequence cursors and heartbeat comments.",
            "content": {"text/event-stream": {"schema": {"type": "string"}}},
        }
    },
)
async def realtime_events(
    request: Request,
    last_event_id: str | None = Header(default=None, alias="Last-Event-ID"),
    current_user: User = Depends(get_current_user),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    return StreamingResponse(
        _event_stream(request, user_id, parse_cursor(last_event_id)),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )
