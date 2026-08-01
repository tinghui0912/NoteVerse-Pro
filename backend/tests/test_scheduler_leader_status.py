from __future__ import annotations

from app.modules.scheduler_lock.beat_leader import BeatLeader
from app.modules.scheduler_lock.constants import BEAT_LEADER_SCHEDULER_NAME


class _Cursor:
    def __init__(self, calls: list[tuple[str, tuple[str, ...]]]) -> None:
        self._calls = calls

    def __enter__(self) -> _Cursor:
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def execute(self, statement: str, parameters: tuple[str, ...]) -> None:
        self._calls.append((statement, parameters))


class _Connection:
    def __init__(self) -> None:
        self.calls: list[tuple[str, tuple[str, ...]]] = []

    def cursor(self) -> _Cursor:
        return _Cursor(self.calls)


def test_leader_status_events_seed_their_own_semantic_fields() -> None:
    leader = BeatLeader(["celery", "-A", "app", "beat"])
    connection = _Connection()

    leader._record_leader_acquired(connection)
    leader._record_standby(connection)
    leader._record_child_exit(connection, 7)

    acquired, standby, child_exit = connection.calls
    assert "acquired_count,\n                last_acquired_at" in acquired[0]
    assert acquired[1] == (BEAT_LEADER_SCHEDULER_NAME,)
    assert "standby_count, last_standby_at" in standby[0]
    assert standby[1] == (BEAT_LEADER_SCHEDULER_NAME,)
    assert "child_exit_count" in child_exit[0]
    assert child_exit[1] == (BEAT_LEADER_SCHEDULER_NAME, "Celery Beat child exited with status 7")
