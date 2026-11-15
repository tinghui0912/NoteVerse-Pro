"""One process LISTEN connection routes coalesced recipient wake hints."""

import asyncio
from contextlib import contextmanager, suppress
import json
from typing import Iterator

import psycopg
from psycopg import sql

from app.db.session import engine
from app.modules.realtime.publisher import REALTIME_NOTIFY_CHANNEL


class RealtimeWakeupHub:
    def __init__(
        self, *, reconnect_seconds: float = 1.0, connect=None, enabled: bool | None = None
    ):
        self._connect = connect
        self._enabled = engine.dialect.name == "postgresql" if enabled is None else enabled
        self._reconnect_seconds = reconnect_seconds
        self._subscribers: dict[int, set[asyncio.Event]] = {}
        self._task: asyncio.Task[None] | None = None
        self.listening = asyncio.Event()

    @contextmanager
    def subscribe(self, user_id: int) -> Iterator[asyncio.Event]:
        signal = asyncio.Event()
        self._subscribers.setdefault(user_id, set()).add(signal)
        try:
            yield signal
        finally:
            subscribers = self._subscribers[user_id]
            subscribers.remove(signal)
            if not subscribers:
                del self._subscribers[user_id]

    def notify(self, payload: str) -> None:
        try:
            data = json.loads(payload)
        except (ValueError, TypeError):
            return
        user_id = data.get("recipient_user_id") if isinstance(data, dict) else None
        if type(user_id) is not int or user_id <= 0:
            return
        for signal in self._subscribers.get(user_id, ()):
            signal.set()

    async def start(self) -> None:
        if self._enabled and self._task is None:
            self._task = asyncio.create_task(self._listen(), name="realtime-wakeup")

    async def stop(self) -> None:
        if self._task is not None:
            self._task.cancel()
            try:
                with suppress(asyncio.CancelledError):
                    await self._task
            finally:
                self._task = None
                self.listening.clear()

    async def _open(self):
        if self._connect is not None:
            return await self._connect()
        args, kwargs = engine.dialect.create_connect_args(engine.url)
        return await psycopg.AsyncConnection.connect(
            *args, **kwargs, autocommit=True, connect_timeout=5
        )

    async def _listen(self) -> None:
        while True:
            connection = None
            try:
                connection = await self._open()
                await connection.execute(
                    sql.SQL("LISTEN {}").format(sql.Identifier(REALTIME_NOTIFY_CHANNEL))
                )
                self.listening.set()
                async for notification in connection.notifies():
                    self.notify(notification.payload)
            except (psycopg.Error, OSError):
                pass
            finally:
                self.listening.clear()
                if connection is not None:
                    with suppress(Exception):
                        await connection.close()
            await asyncio.sleep(self._reconnect_seconds)
