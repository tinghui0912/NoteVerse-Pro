"""Execution handler for saved performance take deletion tasks."""

from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.background_tracing import record_current_attempt_failure
from app.db.models.performance_take import PerformanceTake
from app.db.models.storage_usage import StorageUsageCategory
from app.db.sync_session import get_worker_db
from app.modules.performance_takes.delete_outbox_service import (
    performance_take_delete_outbox_service,
)
from app.modules.storage_usage.service import storage_usage_service
from app.pipeline.context import CeleryTaskLike
from app.storage import file_storage
from app.worker.task_runtime import (
    bind_task_context,
    clear_task_context,
    operation_logger,
    start_attempt_trace,
)


def execute_performance_take_deletion_task(
    task: CeleryTaskLike,
    outbox_uuid: str,
) -> dict[str, str]:
    """Delete one saved performance take media object and finalize DB/quota cleanup."""

    bind_task_context(task)
    trace_scope = None
    try:
        with get_worker_db() as db:
            payload = performance_take_delete_outbox_service.claim(db, outbox_uuid)
            db.commit()
        if payload is None:
            operation_logger(
                "performance_take_deletion.ignored",
                operation_kind="performance_take_deletion",
                outbox_id=outbox_uuid,
                status="ignored",
            ).info("performance_take_deletion.ignored")
            return {"status": "ignored", "outbox_uuid": outbox_uuid}

        trace_scope = start_attempt_trace(
            name="noteverse.performance_take_deletion.delete",
            operation_kind="performance_take_deletion",
            operation_id=outbox_uuid,
            attempt=payload.attempt,
            traceparent=None,
            tracestate=None,
        )
        trace_scope.__enter__()
        context = {
            "operation_kind": "performance_take_deletion",
            "outbox_id": outbox_uuid,
            "take_uuid": payload.take_uuid,
            "storage_backend": payload.storage_backend,
            "object_key": payload.object_key,
            "attempt": payload.attempt,
            "max_attempts": payload.max_attempts,
        }
        operation_logger("performance_take_deletion.started", **context).info(
            "performance_take_deletion.started"
        )

        handled_error = False
        try:
            if payload.storage_backend != file_storage.backend_name:
                raise RuntimeError(
                    "performance take deletion storage backend mismatch: "
                    f"{payload.storage_backend} != {file_storage.backend_name}"
                )
            # 1. Delete object from storage outside of database transaction (idempotent)
            if file_storage.exists(payload.object_key):
                file_storage.delete(payload.object_key)
        except Exception as exc:
            handled_error = True
            record_current_attempt_failure(exc)
            with get_worker_db() as db:
                performance_take_delete_outbox_service.fail(
                    db,
                    outbox_uuid,
                    str(exc),
                )
                db.commit()
            operation_logger(
                "performance_take_deletion.failed",
                **context,
                status="failed",
                exception_type=type(exc).__name__,
            ).opt(exception=True).error("performance_take_deletion.failed")
            return {"status": "failed", "outbox_uuid": outbox_uuid}

        # 2. In single database transaction: delete Take, release quota, complete outbox
        with get_worker_db() as db:
            take = db.execute(
                select(PerformanceTake).where(PerformanceTake.take_uuid == payload.take_uuid)
            ).scalar_one_or_none()
            if take is not None:
                db.delete(take)
                storage_usage_service.record_release_sync(
                    db,
                    user_id=payload.user_id,
                    category=StorageUsageCategory.UPLOAD,
                    bytes_count=payload.media_byte_size,
                    reason="performance_take_deleted",
                    object_type="performance_take",
                    object_id=payload.take_uuid,
                    storage_key=payload.object_key,
                    auto_commit=False,
                )
            performance_take_delete_outbox_service.complete(db, outbox_uuid)
            db.commit()

        operation_logger(
            "performance_take_deletion.completed",
            **context,
            status="completed",
        ).info("performance_take_deletion.completed")
        return {"status": "deleted", "outbox_uuid": outbox_uuid}
    finally:
        if trace_scope is not None:
            if handled_error:
                trace_scope.__exit__(None, None, None)
            else:
                trace_scope.__exit__(*sys.exc_info())
        clear_task_context()
