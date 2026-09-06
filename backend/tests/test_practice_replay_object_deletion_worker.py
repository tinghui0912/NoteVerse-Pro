from contextlib import contextmanager
from types import SimpleNamespace
from typing import Iterator

from app.modules.practice.replay_object_deletion_outbox_service import (
    PracticeReplayObjectDeletionPayload,
)
from app.worker.execution import practice_replay_object_deletion


class _TraceScope:
    def __enter__(self) -> None:
        return None

    def __exit__(self, *_args: object) -> None:
        return None


@contextmanager
def _db_context() -> Iterator[object]:
    yield object()


def test_practice_replay_object_deletion_worker_deletes_object_and_completes(
    monkeypatch,
) -> None:
    deleted_keys: list[str] = []
    completed: list[str] = []

    class FakeOutboxService:
        def claim(self, _db: object, outbox_uuid: str) -> PracticeReplayObjectDeletionPayload:
            return PracticeReplayObjectDeletionPayload(
                outbox_uuid=outbox_uuid,
                storage_backend="fake",
                object_key="practice/replays/session-1/artifact-1.webm",
                attempt=1,
                max_attempts=5,
            )

        def complete(self, _db: object, outbox_uuid: str) -> None:
            completed.append(outbox_uuid)

        def fail(self, _db: object, outbox_uuid: str, error: str) -> None:
            raise AssertionError(f"unexpected failure for {outbox_uuid}: {error}")

    class FakeStorage:
        backend_name = "fake"

        def delete(self, key: str) -> bool:
            deleted_keys.append(key)
            return False

    monkeypatch.setattr(practice_replay_object_deletion, "get_worker_db", _db_context)
    monkeypatch.setattr(
        practice_replay_object_deletion,
        "practice_replay_object_deletion_outbox_service",
        FakeOutboxService(),
    )
    monkeypatch.setattr(practice_replay_object_deletion, "file_storage", FakeStorage())
    monkeypatch.setattr(
        practice_replay_object_deletion,
        "start_attempt_trace",
        lambda **_kwargs: _TraceScope(),
    )

    result = practice_replay_object_deletion.execute_practice_replay_object_deletion_task(
        SimpleNamespace(request=SimpleNamespace(id="task-1")),
        "outbox-1",
    )

    assert result == {"status": "deleted", "outbox_uuid": "outbox-1"}
    assert deleted_keys == ["practice/replays/session-1/artifact-1.webm"]
    assert completed == ["outbox-1"]
