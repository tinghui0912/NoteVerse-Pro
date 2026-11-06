"""Execution handler for immutable practice bundle cleanup tasks."""

from __future__ import annotations

import sys

from sqlalchemy import select

from app.core.background_tracing import record_current_attempt_failure
from app.db.models import (
    PracticeBundleRecord,
    PracticeBundleDeleteOutboxStatus,
)
from app.db.sync_session import get_worker_db
from app.modules.practice.bundle.retention import (
    practice_bundle_delete_service,
)
from app.storage import file_storage
from app.worker.task_runtime import (
    bind_task_context,
    clear_task_context,
    operation_logger,
    start_attempt_trace,
)
from app.pipeline.context import CeleryTaskLike


def execute_practice_bundle_deletion_task(
    task: CeleryTaskLike,
    outbox_uuid: str,
) -> dict[str, str]:
    """Delete bundle storage and DB row after all durable references are gone."""

    bind_task_context(task)
    trace_scope = None
    handled_error = False
    try:
        with get_worker_db() as db:
            payload = practice_bundle_delete_service.claim(db, outbox_uuid)
            db.commit()
        if payload is None:
            return {"status": "ignored", "outbox_uuid": outbox_uuid}

        trace_scope = start_attempt_trace(
            name="noteverse.practice_bundle_deletion.delete",
            operation_kind="practice_bundle_deletion",
            operation_id=outbox_uuid,
            attempt=payload.attempt,
            traceparent=None,
            tracestate=None,
        )
        trace_scope.__enter__()
        context = {
            "operation_kind": "practice_bundle_deletion",
            "outbox_id": outbox_uuid,
            "bundle_id": payload.bundle_id,
            "storage_backend": payload.storage_backend,
            "attempt": payload.attempt,
            "max_attempts": payload.max_attempts,
        }
        operation_logger("practice_bundle_deletion.started", **context).info(
            "practice_bundle_deletion.started"
        )

        try:
            with get_worker_db() as db:
                outbox = practice_bundle_delete_service._get(db, outbox_uuid, lock=True)
                if outbox is None:
                    raise RuntimeError("Practice bundle deletion outbox missing")
                if outbox.status == PracticeBundleDeleteOutboxStatus.COMPLETED.value:
                    return {"status": "ignored", "outbox_uuid": outbox_uuid}
                if (
                    outbox.status != PracticeBundleDeleteOutboxStatus.PROCESSING.value
                    or outbox.attempt_count != payload.attempt
                ):
                    raise RuntimeError("Practice bundle deletion lease mismatch")
                bundle = None
                if payload.practice_bundle_id is not None:
                    bundle = db.execute(
                        select(PracticeBundleRecord)
                        .where(PracticeBundleRecord.id == payload.practice_bundle_id)
                        .with_for_update()
                        .execution_options(populate_existing=True)
                    ).scalar_one_or_none()
                if bundle is not None and (
                    bundle.status != "DELETING"
                    or practice_bundle_delete_service.has_owner(db, bundle)
                ):
                    raise RuntimeError("Practice bundle deletion ownership invariant violated")
                if payload.storage_backend != file_storage.backend_name:
                    raise RuntimeError("Practice bundle deletion storage backend mismatch")
                # The bundle/outbox locks fence ownership and attempt replacement across exact object deletion.
                for key in (payload.prepared_musicxml_object_key, payload.artifact_object_key):
                    if file_storage.exists(key):
                        file_storage.delete(key)
                    if file_storage.exists(key):
                        raise RuntimeError("Practice bundle object remains after deletion")
                if bundle is not None:
                    if practice_bundle_delete_service.has_owner(db, bundle):
                        raise RuntimeError("Practice bundle deletion ownership invariant violated")
                    db.delete(bundle)
                    db.flush()
                if not practice_bundle_delete_service.complete(
                    db, outbox_uuid, attempt=payload.attempt
                ):
                    raise RuntimeError("Practice bundle deletion completion failed")
                db.commit()
        except Exception as error:
            handled_error = True
            record_current_attempt_failure(error)
            with get_worker_db() as db:
                db.rollback()
                practice_bundle_delete_service.fail(
                    db, outbox_uuid, str(error), attempt=payload.attempt
                )
                db.commit()
            operation_logger(
                "practice_bundle_deletion.failed",
                **context,
                status="failed",
                exception_type=type(error).__name__,
            ).opt(exception=True).error("practice_bundle_deletion.failed")
            return {"status": "failed", "outbox_uuid": outbox_uuid}

        operation_logger(
            "practice_bundle_deletion.completed",
            **context,
            status="completed",
        ).info("practice_bundle_deletion.completed")
        return {"status": "deleted", "outbox_uuid": outbox_uuid}
    finally:
        if trace_scope is not None:
            if handled_error:
                trace_scope.__exit__(None, None, None)
            else:
                trace_scope.__exit__(*sys.exc_info())
        clear_task_context()
