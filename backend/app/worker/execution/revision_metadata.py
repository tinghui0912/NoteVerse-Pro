"""Compute outside delivery locks; metadata/result/completion/realtime commit together."""

from app.modules.media_storage.reads import read_admitted_bytes

import sys
from hashlib import sha256
from app.core.background_tracing import record_current_attempt_failure
from app.modules.revisions.metadata_delivery import compute_metadata, metadata_lifecycle
from app.modules.durable_work.delivery import StaleDeliveryAttempt
from app.task_queue.protocols import CeleryTaskLike
from app.worker.task_runtime import (
    bind_task_context,
    clear_task_context,
    start_attempt_trace,
    operation_logger,
    run_scheduler_scan,
)
from app.runtime.worker.context import get_context


def execute_revision_metadata_task(task: CeleryTaskLike, outbox_uuid: str) -> dict[str, str]:
    bind_task_context(task)
    trace = None
    try:
        with get_context().sessions() as db:
            payload = get_context().deliveries.metadata.claim(db, outbox_uuid)
            db.commit()
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
            content = read_admitted_bytes(get_context().storage, payload.source)
            if sha256(content).hexdigest() != payload.source_fingerprint:
                raise ValueError("canonical_source_fingerprint_mismatch")
            result = compute_metadata(content)
            with get_context().sessions() as db:
                get_context().deliveries.metadata.adopt(db, payload, result)
                db.commit()
        except StaleDeliveryAttempt:
            return {"status": "stale"}
        except Exception as exc:
            record_current_attempt_failure(exc)
            with get_context().sessions() as db:
                accepted = get_context().deliveries.metadata.fail(
                    db, outbox_uuid, payload.lease, type(exc).__name__
                )
                db.commit()
            operation_logger(
                "revision_metadata.failed",
                operation_kind="revision_metadata",
                outbox_id=outbox_uuid,
                attempt=payload.lease.attempt,
                max_attempts=metadata_lifecycle(config=get_context().settings).policy.max_attempts,
                originating_request_id=payload.originating_request_id,
            ).error("revision_metadata.failed")
            return {"status": "failed" if accepted else "stale"}
        operation_logger(
            "revision_metadata.completed",
            operation_kind="revision_metadata",
            outbox_id=outbox_uuid,
            attempt=payload.lease.attempt,
            max_attempts=metadata_lifecycle(config=get_context().settings).policy.max_attempts,
            originating_request_id=payload.originating_request_id,
        ).info("revision_metadata.completed")
        return {"status": "completed"}
    finally:
        if trace is not None:
            trace.__exit__(*sys.exc_info())
        clear_task_context()


def execute_revision_metadata_maintenance() -> dict[str, int]:
    def scan():

        with get_context().sessions() as db:
            due = get_context().deliveries.metadata.recover_and_list_due(db)
            db.commit()
        return {
            "due": len(due),
            "dispatched": sum(
                get_context().dispatches.metadata.dispatch_revision_metadata(uuid) for uuid in due
            ),
        }

    return run_scheduler_scan("revision_metadata", scan)
