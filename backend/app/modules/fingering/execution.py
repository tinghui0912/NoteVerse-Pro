"""Bounded execution for blocking interactive fingering engines."""

from __future__ import annotations

from collections.abc import Callable
from typing import ParamSpec, TypeVar

import anyio

from app.core.config import settings
from app.core.metrics import (
    fingering_generation_completed,
    fingering_generation_queue_rejected,
    fingering_generation_started,
)

P = ParamSpec("P")
T = TypeVar("T")


class FingeringExecutionCapacityExceeded(Exception):
    """Raised when the interactive generation queue cannot admit a request."""


class FingeringExecutionService:
    """Keep CPU-bound fingering calls out of the API event loop.

    The third-party engine exposes only a blocking callable. Capacity is held
    until that callable returns, so a caller timeout never permits unbounded
    background work to accumulate.
    """

    def __init__(self, *, max_concurrency: int, queue_wait_seconds: float) -> None:
        self._limiter = anyio.CapacityLimiter(max_concurrency)
        self._queue_wait_seconds = queue_wait_seconds

    async def run(self, operation: Callable[P, T], /, *args: P.args, **kwargs: P.kwargs) -> T:
        try:
            with anyio.fail_after(self._queue_wait_seconds):
                await self._limiter.acquire()
        except TimeoutError as exc:
            fingering_generation_queue_rejected()
            raise FingeringExecutionCapacityExceeded from exc

        fingering_generation_started()
        try:
            result = await anyio.to_thread.run_sync(
                lambda: operation(*args, **kwargs),
                abandon_on_cancel=False,
            )
        except Exception:
            fingering_generation_completed(status="failed")
            raise
        else:
            fingering_generation_completed(status="succeeded")
            return result
        finally:
            self._limiter.release()


fingering_execution_service = FingeringExecutionService(
    max_concurrency=settings.FINGERING_MAX_CONCURRENCY,
    queue_wait_seconds=settings.FINGERING_QUEUE_WAIT_SECONDS,
)
