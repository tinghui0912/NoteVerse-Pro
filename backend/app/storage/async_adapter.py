"""Async provider scheduling over the same synchronous object namespace.

Cancellation waits for an in-flight provider call to settle before returning control:
callers may hold a write-generation lock that must cover the entire physical mutation.
"""

import asyncio
from collections.abc import AsyncIterator, Callable
from typing import TypeVar
from .base import ObjectStorage, ObjectWriteResult, ObjectMetadata, DirectUploadTarget

T = TypeVar("T")


class AsyncObjectStorage:
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

    async def put_bytes(
        self, *, key: str, content: bytes, content_type: str | None = None
    ) -> ObjectWriteResult:
        return await self._run(
            lambda: self._storage.put_bytes(key=key, content=content, content_type=content_type)
        )

    async def exists(self, key: str) -> bool:
        return await self._run(lambda: self._storage.exists(key))

    async def read_bytes(self, key: str) -> bytes:
        return await self._run(lambda: self._storage.read_bytes(key))

    async def object_metadata(self, key: str) -> ObjectMetadata:
        return await self._run(lambda: self._storage.object_metadata(key))

    async def copy(self, source_key: str, target_key: str) -> None:
        await self._run(lambda: self._storage.copy(source_key, target_key))

    async def delete(self, key: str) -> bool:
        return await self._run(lambda: self._storage.delete(key))

    async def download_url(
        self,
        key: str,
        *,
        filename: str | None = None,
        content_type: str | None = None,
        expires_seconds: int | None = None,
    ) -> str:
        return await self._run(
            lambda: self._storage.download_url(
                key, filename=filename, content_type=content_type, expires_seconds=expires_seconds
            )
        )

    async def upload_url(
        self, key: str, *, content_type: str, checksum_sha256: str
    ) -> DirectUploadTarget:
        return await self._run(
            lambda: self._storage.upload_url(
                key, content_type=content_type, checksum_sha256=checksum_sha256
            )
        )

    async def materialize_to_local(self, key: str, target_path: str) -> str:
        return await self._run(lambda: self._storage.materialize_to_local(key, target_path))

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
