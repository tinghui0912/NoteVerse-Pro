"""Cancellation-safe scheduling of provider stream reads and closure."""

import asyncio
from collections.abc import AsyncIterator, Callable
from typing import TypeVar
from .base import ObjectStorage

T = TypeVar("T")


class AsyncObjectReader:
    def __init__(self, storage: ObjectStorage) -> None:
        self._storage = storage

    async def _run(self, call: Callable[[], T]) -> T:
        task = asyncio.create_task(asyncio.to_thread(call))
        cancelled = None
        while not task.done():
            try:
                await asyncio.shield(task)
            except asyncio.CancelledError as exc:
                cancelled = exc
            except Exception:
                if cancelled is None:
                    raise
        if cancelled is not None:
            if not task.cancelled():
                task.exception()  # Observe a provider error without hiding cancellation.
            raise cancelled
        return task.result()

    async def iter_bytes(
        self,
        key: str,
        *,
        chunk_size: int = 1024 * 1024,
        start: int | None = None,
        end: int | None = None,
    ) -> AsyncIterator[bytes]:
        iterator = await self._run(
            lambda: self._storage.iter_bytes(key, chunk_size=chunk_size, start=start, end=end)
        )

        def advance() -> tuple[bool, bytes]:
            try:
                return True, next(iterator)
            except StopIteration:
                return False, b""

        try:
            while True:
                available, chunk = await self._run(advance)
                if not available:
                    break
                yield chunk
        finally:
            close = getattr(iterator, "close", None)
            if close is not None:
                await self._run(close)
