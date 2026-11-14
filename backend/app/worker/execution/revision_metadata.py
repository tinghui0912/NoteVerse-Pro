"""Compute outside delivery locks; metadata/result/completion/realtime commit together."""

import sys
from hashlib import sha256
from app.core.background_tracing import record_current_attempt_failure
from app.db.sync_session import get_worker_db
from app.modules.revisions.metadata_delivery import (
    metadata_delivery,
    compute_metadata,
    metadata_lifecycle,
)
from app.modules.async_operations.durable_delivery import StaleDeliveryAttempt
from app.pipeline.context import CeleryTaskLike
from app.storage import object_storage
from app.worker.task_runtime import (
    bind_task_context,
    clear_task_context,
    start_attempt_trace,
    operation_logger,
    run_scheduler_scan,
)


def execute_revision_metadata_task(task: CeleryTaskLike, outbox_uuid: str) -> dict[str, str]:
    bind_task_context(task)
    trace = None
    try:
        with get_worker_db() as db:
            payload = metadata_delivery.claim(db, outbox_uuid)
        if payload is None:
            return {"status": "ignored"}
        trace = start_attempt_trace(
            name="noteverse.revision_metadata.compute",
            operation_kind="revision_metadata",
            operation_id=outbox_uuid,
            attempt=payload.lease.attempt,
            traceparent=payload.traceparent,
            tracestate=payload.tracestate,
        )
        trace.__enter__()
        try:
            content = object_storage.read_bytes(payload.source_key)
            if sha256(content).hexdigest() != payload.source_fingerprint:
                raise ValueError("canonical_source_fingerprint_mismatch")
            result = compute_metadata(content)
            with get_worker_db() as db:
                metadata_delivery.adopt(db, payload, result)
        except StaleDeliveryAttempt:
            return {"status": "stale"}
        except Exception as exc:
            record_current_attempt_failure(exc)
            with get_worker_db() as db:
                accepted = metadata_delivery.fail(
                    db, outbox_uuid, payload.lease, type(exc).__name__
                )
            operation_logger(
                "revision_metadata.failed",
                operation_kind="revision_metadata",
                outbox_id=outbox_uuid,
                attempt=payload.lease.attempt,
                max_attempts=metadata_lifecycle().policy.max_attempts,
                originating_request_id=payload.originating_request_id,
            ).error("revision_metadata.failed")
            return {"status": "failed" if accepted else "stale"}
        operation_logger(
            "revision_metadata.completed",
            operation_kind="revision_metadata",
            outbox_id=outbox_uuid,
            attempt=payload.lease.attempt,
            max_attempts=metadata_lifecycle().policy.max_attempts,
            originating_request_id=payload.originating_request_id,
        ).info("revision_metadata.completed")
        return {"status": "completed"}
    finally:
        if trace is not None:
            trace.__exit__(*sys.exc_info())
        clear_task_context()


def execute_revision_metadata_maintenance() -> dict[str, int]:
    def scan():
        from app.modules.revisions.metadata_dispatch import dispatch_revision_metadata

        with get_worker_db() as db:
            due = metadata_delivery.recover_and_list_due(db)
        return {
            "due": len(due),
            "dispatched": sum(dispatch_revision_metadata(uuid) for uuid in due),
        }

    return run_scheduler_scan("revision_metadata", scan)
