"""Execution handler for saved performance take deletion tasks."""

from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.background_tracing import record_current_attempt_failure
from app.db.models.performance_take_manifest import PerformanceTakeManifest
from app.db.models.performance_take import PerformanceTake
from app.db.models.stored_object import StoredObject
from app.db.models.performance_take_delete_outbox import (
    PerformanceTakeDeleteOutbox,
    PerformanceTakeDeleteOutboxStatus,
)
from app.modules.performance_takes.aggregate import take_from_row
from app.db.models.storage_usage import StorageUsageCategory
from app.db.sync_session import get_worker_db
from app.modules.performance_takes.delete_outbox_service import (
    performance_take_delete_outbox_service,
)
from app.modules.storage_usage.service import storage_usage_service
from app.pipeline.context import CeleryTaskLike
from app.storage import object_storage
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
            "object_key": payload.object_key,
            "attempt": payload.attempt,
            "max_attempts": payload.max_attempts,
        }
        operation_logger("performance_take_deletion.started", **context).info(
            "performance_take_deletion.started"
        )

        handled_error = False
        storage_failed = False
        # Delete only the Take media/row and release its storage usage.
        # PracticeBundle lifetime is independent and belongs to ScoreRevision.
        try:
            with get_worker_db() as db:
                outbox = db.execute(
                    select(PerformanceTakeDeleteOutbox)
                    .where(PerformanceTakeDeleteOutbox.outbox_uuid == outbox_uuid)
                    .with_for_update()
                ).scalar_one_or_none()
                if outbox is None:
                    raise RuntimeError(
                        f"performance take deletion outbox missing during completion: {outbox_uuid}"
                    )
                if outbox.status == PerformanceTakeDeleteOutboxStatus.COMPLETED:
                    db.commit()
                    operation_logger(
                        "performance_take_deletion.completed_idempotently",
                        **context,
                        status="completed",
                    ).info("performance_take_deletion.completed_idempotently")
                    return {"status": "deleted", "outbox_uuid": outbox_uuid}
                if outbox.status != PerformanceTakeDeleteOutboxStatus.PROCESSING:
                    raise RuntimeError(
                        "performance take deletion outbox is not processing during completion: "
                        f"{outbox_uuid}"
                    )
                if outbox.attempt_count != payload.attempt:
                    raise RuntimeError(
                        "performance take deletion outbox attempt changed during processing: "
                        f"{outbox_uuid}"
                    )
                if (
                    outbox.take_uuid != payload.take_uuid
                    or outbox.user_id != payload.user_id
                    or outbox.object_key != payload.object_key
                    or outbox.media_byte_size != payload.media_byte_size
                ):
                    raise RuntimeError(
                        "performance take deletion outbox payload changed during processing: "
                        f"{outbox_uuid}"
                    )
                take = db.execute(
                    select(PerformanceTake)
                    .join(PerformanceTakeManifest)
                    .where(
                        PerformanceTakeManifest.take_uuid == payload.take_uuid,
                        PerformanceTakeManifest.user_id == payload.user_id,
                    )
                    .with_for_update(of=PerformanceTake)
                ).scalar_one_or_none()
                if take is not None:
                    blob = take_from_row(take).recording_object
                    if (
                        blob.object_key != payload.object_key
                        or blob.byte_size != payload.media_byte_size
                    ):
                        raise RuntimeError(
                            "performance take deletion payload does not match locked take: "
                            f"{payload.take_uuid}"
                        )
                    db.delete(take)
                    db.flush()
                    db.delete(take.recording_object)
                    db.flush()
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
                else:
                    remaining = db.scalar(
                        select(StoredObject).where(StoredObject.object_key == payload.object_key)
                    )
                    if remaining is not None:
                        if remaining.byte_size != payload.media_byte_size:
                            raise RuntimeError("Take deletion snapshot disagrees with StoredObject")
                        db.delete(remaining)
                        db.flush()
                # FK checks run before deleting bytes, so an object still referenced elsewhere is protected.
                try:
                    if object_storage.exists(payload.object_key):
                        object_storage.delete(payload.object_key)
                except Exception:
                    storage_failed = True
                    raise
                if not performance_take_delete_outbox_service.complete(
                    db,
                    outbox_uuid,
                    attempt=payload.attempt,
                ):
                    raise RuntimeError(
                        f"performance take deletion outbox completion lease mismatch: {outbox_uuid}"
                    )
                db.commit()
        except Exception as exc:
            if not storage_failed:
                raise
            handled_error = True
            record_current_attempt_failure(exc)
            with get_worker_db() as db:
                db.rollback()
                performance_take_delete_outbox_service.fail(
                    db,
                    outbox_uuid,
                    str(exc),
                    attempt=payload.attempt,
                )
                db.commit()
            operation_logger(
                "performance_take_deletion.failed",
                **context,
                status="failed",
                exception_type=type(exc).__name__,
            ).opt(exception=True).error("performance_take_deletion.failed")
            return {"status": "failed", "outbox_uuid": outbox_uuid}

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
