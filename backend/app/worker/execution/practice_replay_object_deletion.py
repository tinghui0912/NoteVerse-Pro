"""Execution handler for saved practice replay object deletion tasks."""

from __future__ import annotations

import sys

from app.core.background_tracing import record_current_attempt_failure
from app.db.sync_session import get_worker_db
from app.modules.practice.replay_object_deletion_outbox_service import (
    practice_replay_object_deletion_outbox_service,
)
from app.pipeline.context import CeleryTaskLike
from app.storage import file_storage
from app.worker.task_runtime import (
    bind_task_context,
    clear_task_context,
    operation_logger,
    start_attempt_trace,
)


def execute_practice_replay_object_deletion_task(
    task: CeleryTaskLike,
    outbox_uuid: str,
) -> dict[str, str]:
    """Delete one saved practice replay object from object storage."""

    bind_task_context(task)
    trace_scope = None
    try:
        with get_worker_db() as db:
            payload = practice_replay_object_deletion_outbox_service.claim(db, outbox_uuid)
        if payload is None:
            operation_logger(
                "practice_replay_object_deletion.ignored",
                operation_kind="practice_replay_object_deletion",
                outbox_id=outbox_uuid,
                status="ignored",
            ).info("practice_replay_object_deletion.ignored")
            return {"status": "ignored", "outbox_uuid": outbox_uuid}

        trace_scope = start_attempt_trace(
            name="noteverse.practice_replay_object_deletion.delete",
            operation_kind="practice_replay_object_deletion",
            operation_id=outbox_uuid,
            attempt=payload.attempt,
            traceparent=None,
            tracestate=None,
        )
        trace_scope.__enter__()
        context = {
            "operation_kind": "practice_replay_object_deletion",
            "outbox_id": outbox_uuid,
            "storage_backend": payload.storage_backend,
            "object_key": payload.object_key,
            "attempt": payload.attempt,
            "max_attempts": payload.max_attempts,
        }
        operation_logger("practice_replay_object_deletion.started", **context).info(
            "practice_replay_object_deletion.started"
        )

        try:
            if payload.storage_backend != file_storage.backend_name:
                raise RuntimeError(
                    "practice replay deletion storage backend mismatch: "
                    f"{payload.storage_backend} != {file_storage.backend_name}"
                )
            file_storage.delete(payload.object_key)
        except Exception as exc:
            record_current_attempt_failure(exc)
            with get_worker_db() as db:
                practice_replay_object_deletion_outbox_service.fail(
                    db,
                    outbox_uuid,
                    str(exc),
                )
            operation_logger(
                "practice_replay_object_deletion.failed",
                **context,
                status="failed",
                exception_type=type(exc).__name__,
            ).opt(exception=True).error("practice_replay_object_deletion.failed")
            return {"status": "failed", "outbox_uuid": outbox_uuid}

        with get_worker_db() as db:
            practice_replay_object_deletion_outbox_service.complete(db, outbox_uuid)
        operation_logger(
            "practice_replay_object_deletion.completed",
            **context,
            status="completed",
        ).info("practice_replay_object_deletion.completed")
        return {"status": "deleted", "outbox_uuid": outbox_uuid}
    finally:
        if trace_scope is not None:
            trace_scope.__exit__(*sys.exc_info())
        clear_task_context()
