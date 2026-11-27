"""Structural Celery execution protocols shared by domain workers."""

from typing import Protocol, TypedDict


class CeleryStateMeta(TypedDict):
    """Progress payload sent back to Celery state updates."""

    status: str
    progress: int
    current_step: str


class CeleryRequestLike(Protocol):
    """Subset of the Celery request object used by task execution."""

    id: str


class CeleryTaskLike(Protocol):
    """Subset of Celery task behavior used by worker execution."""

    request: CeleryRequestLike

    def update_state(self, state: str, meta: CeleryStateMeta) -> None: ...
