"""Shared lifecycle identity for Wait For Note practice attempts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal
from uuid import uuid4


AttemptLifecycleState = Literal["pending", "resolved"]


@dataclass(frozen=True)
class PracticeAttemptSnapshot:
    attempt_id: str
    attempt_sequence: int
    expected_group_id: str
    started_at_ms: int
    state: AttemptLifecycleState
    resolved_at_ms: int | None = None


class PracticeAttemptLifecycle:
    """Assigns stable identity to one user gesture at a time."""

    def __init__(self) -> None:
        self._next_sequence = 1
        self._current: PracticeAttemptSnapshot | None = None

    @property
    def current(self) -> PracticeAttemptSnapshot | None:
        return self._current

    def begin(self, *, expected_group_id: str, timestamp_ms: int) -> PracticeAttemptSnapshot:
        if self._current is not None and self._current.state == "pending":
            return self._current

        sequence = self._next_sequence
        self._next_sequence += 1
        self._current = PracticeAttemptSnapshot(
            attempt_id=str(uuid4()),
            attempt_sequence=sequence,
            expected_group_id=expected_group_id,
            started_at_ms=timestamp_ms,
            state="pending",
        )
        return self._current

    def resolve(self, *, timestamp_ms: int) -> PracticeAttemptSnapshot | None:
        if self._current is None:
            return None
        if self._current.state == "resolved":
            return self._current

        self._current = PracticeAttemptSnapshot(
            attempt_id=self._current.attempt_id,
            attempt_sequence=self._current.attempt_sequence,
            expected_group_id=self._current.expected_group_id,
            started_at_ms=self._current.started_at_ms,
            state="resolved",
            resolved_at_ms=timestamp_ms,
        )
        return self._current

    def clear_current(self) -> None:
        self._current = None

    def reset(self) -> None:
        self._next_sequence = 1
        self._current = None
