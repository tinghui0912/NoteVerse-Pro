"""Execution handler for immutable practice source snapshot cleanup tasks."""

from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.background_tracing import record_current_attempt_failure
from app.db.models import PracticeSourceSnapshot, PracticeSourceSnapshotDeleteOutboxStatus
from app.db.sync_session import get_worker_db
from app.modules.performance_takes.source_snapshot_delete_service import (
    practice_source_snapshot_delete_service,
)
from app.storage import file_storage
from app.worker.task_runtime import (
    bind_task_context,
    clear_task_context,
    operation_logger,
    start_attempt_trace,
)
from app.pipeline.context import CeleryTaskLike


def execute_practice_source_snapshot_deletion_task(
    task: CeleryTaskLike,
    outbox_uuid: str,
) -> dict[str, str]:
    """Delete snapshot storage and DB row after all durable references are gone."""

    bind_task_context(task)
    trace_scope = None
    handled_error = False
    try:
        with get_worker_db() as db:
            payload = practice_source_snapshot_delete_service.claim(db, outbox_uuid)
            db.commit()
        if payload is None:
            return {"status": "ignored", "outbox_uuid": outbox_uuid}

        trace_scope = start_attempt_trace(
            name="noteverse.practice_source_snapshot_deletion.delete",
            operation_kind="practice_source_snapshot_deletion",
            operation_id=outbox_uuid,
            attempt=payload.attempt,
            traceparent=None,
            tracestate=None,
        )
        trace_scope.__enter__()
        context = {
            "operation_kind": "practice_source_snapshot_deletion",
            "outbox_id": outbox_uuid,
            "snapshot_uuid": payload.snapshot_uuid,
            "storage_backend": payload.storage_backend,
            "attempt": payload.attempt,
            "max_attempts": payload.max_attempts,
        }
        operation_logger("practice_source_snapshot_deletion.started", **context).info(
            "practice_source_snapshot_deletion.started"
        )

        try:
            if payload.storage_backend != file_storage.backend_name:
                raise RuntimeError(
                    "practice source snapshot deletion storage backend mismatch: "
                    f"{payload.storage_backend} != {file_storage.backend_name}"
                )
            for object_key in [
                payload.prepared_musicxml_object_key,
                payload.artifact_object_key,
            ]:
                if file_storage.exists(object_key):
                    file_storage.delete(object_key)
                if file_storage.exists(object_key):
                    raise RuntimeError(
                        "practice source snapshot object still exists after delete: "
                        f"{object_key}"
                    )
        except Exception as exc:
            handled_error = True
            record_current_attempt_failure(exc)
            with get_worker_db() as db:
                practice_source_snapshot_delete_service.fail(
                    db,
                    outbox_uuid,
                    str(exc),
                    attempt=payload.attempt,
                )
                db.commit()
            operation_logger(
                "practice_source_snapshot_deletion.failed",
                **context,
                status="failed",
                exception_type=type(exc).__name__,
            ).opt(exception=True).error("practice_source_snapshot_deletion.failed")
            return {"status": "failed", "outbox_uuid": outbox_uuid}

        with get_worker_db() as db:
            outbox = practice_source_snapshot_delete_service._get(
                db, outbox_uuid, lock=True
            )
            if outbox is None:
                raise RuntimeError(
                    f"practice source snapshot deletion outbox missing: {outbox_uuid}"
                )
            if outbox.status == PracticeSourceSnapshotDeleteOutboxStatus.COMPLETED.value:
                db.commit()
                return {"status": "deleted", "outbox_uuid": outbox_uuid}
            if (
                outbox.status
                != PracticeSourceSnapshotDeleteOutboxStatus.PROCESSING.value
                or outbox.attempt_count != payload.attempt
            ):
                raise RuntimeError(
                    "practice source snapshot deletion lease mismatch: "
                    f"{outbox_uuid}"
                )
            if payload.source_snapshot_id is not None:
                if (
                    practice_source_snapshot_delete_service.active_reference_count(
                        db, payload.source_snapshot_id
                    )
                    > 0
                ):
                    practice_source_snapshot_delete_service.complete(
                        db, outbox_uuid, attempt=payload.attempt
                    )
                    db.commit()
                    return {"status": "ignored", "outbox_uuid": outbox_uuid}
                snapshot = db.execute(
                    select(PracticeSourceSnapshot)
                    .where(PracticeSourceSnapshot.id == payload.source_snapshot_id)
                    .with_for_update()
                ).scalar_one_or_none()
                if snapshot is not None:
                    db.delete(snapshot)
            if not practice_source_snapshot_delete_service.complete(
                db, outbox_uuid, attempt=payload.attempt
            ):
                raise RuntimeError(
                    "practice source snapshot deletion completion failed: "
                    f"{outbox_uuid}"
                )
            db.commit()

        operation_logger(
            "practice_source_snapshot_deletion.completed",
            **context,
            status="completed",
        ).info("practice_source_snapshot_deletion.completed")
        return {"status": "deleted", "outbox_uuid": outbox_uuid}
    finally:
        if trace_scope is not None:
            if handled_error:
                trace_scope.__exit__(None, None, None)
            else:
                trace_scope.__exit__(*sys.exc_info())
        clear_task_context()
