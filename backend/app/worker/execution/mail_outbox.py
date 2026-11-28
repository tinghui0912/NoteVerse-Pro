"""Execution handler for transactional-mail outbox Celery tasks."""

from __future__ import annotations


import sys

from app.core.background_tracing import record_current_attempt_failure
from app.composition.mail_delivery import validate_mail_source
from app.task_queue.protocols import CeleryTaskLike
from app.utils.email import MailPermanentError, MailTransientError, send_email, MailTransportConfig
from app.worker.task_runtime import (
    bind_task_context,
    clear_task_context,
    operation_logger,
    start_attempt_trace,
)
from app.runtime.worker.context import get_context


def execute_mail_outbox_task(task: CeleryTaskLike, outbox_uuid: str) -> dict[str, str]:
    """Deliver one persistent transactional-mail record."""

    bind_task_context(task)
    trace_scope = None
    try:
        with get_context().sessions() as db:
            source_active = validate_mail_source(db, outbox_uuid)
            payload = (
                get_context().deliveries.mail.claim(db, outbox_uuid) if source_active else None
            )
            db.commit()
        if payload is None:
            operation_logger(
                "mail.ignored",
                operation_kind="mail",
                outbox_id=outbox_uuid,
                status="ignored",
            ).info("mail.ignored")
            return {"status": "ignored", "outbox_uuid": outbox_uuid}

        trace_scope = start_attempt_trace(
            name="noteverse.mail.deliver",
            operation_kind="mail",
            operation_id=outbox_uuid,
            attempt=payload.lease.attempt,
            traceparent=payload.traceparent,
            tracestate=payload.tracestate,
        )
        trace_scope.__enter__()

        context = {
            "operation_kind": "mail",
            "outbox_id": outbox_uuid,
            "category": payload.category,
            "attempt": payload.lease.attempt,
            "max_attempts": payload.max_attempts,
            "originating_request_id": payload.originating_request_id,
        }
        operation_logger("mail.started", **context).info("mail.started")
        with get_context().sessions.begin() as db:
            permitted = validate_mail_source(
                db, outbox_uuid
            ) and get_context().deliveries.mail.delivery_permitted(
                db, outbox_uuid, lease=payload.lease
            )
        if not permitted:
            return {"status": "stale", "outbox_uuid": outbox_uuid}
        try:
            provider_message_id = send_email(
                to_email=payload.recipient,
                subject=payload.subject,
                body=payload.text_body,
                html_body=payload.html_body,
                config=MailTransportConfig.model_validate(get_context().settings.model_dump()),
            )
        except MailPermanentError as exc:
            record_current_attempt_failure(exc)
            with get_context().sessions() as db:
                accepted = get_context().deliveries.mail.permanent_failure(
                    db, outbox_uuid, str(exc), lease=payload.lease
                )
                db.commit()
            if not accepted:
                return {"status": "stale", "outbox_uuid": outbox_uuid}
            operation_logger(
                "mail.failed",
                **context,
                status="permanent_failure",
                exception_type=type(exc).__name__,
            ).warning("mail.failed")
            return {"status": "permanent_failure", "outbox_uuid": outbox_uuid}
        except MailTransientError as exc:
            record_current_attempt_failure(exc)
            with get_context().sessions() as db:
                accepted = get_context().deliveries.mail.transient_failure(
                    db, outbox_uuid, str(exc), lease=payload.lease
                )
                db.commit()
            if not accepted:
                return {"status": "stale", "outbox_uuid": outbox_uuid}
            operation_logger(
                "mail.failed",
                **context,
                status="retrying",
                exception_type=type(exc).__name__,
            ).warning("mail.failed")
            return {"status": "failed", "outbox_uuid": outbox_uuid}

        except Exception as exc:
            record_current_attempt_failure(exc)
            with get_context().sessions() as db:
                accepted = get_context().deliveries.mail.execution_failure(
                    db, outbox_uuid, str(exc), lease=payload.lease
                )
                db.commit()
            return {"status": "failed" if accepted else "stale", "outbox_uuid": outbox_uuid}

        with get_context().sessions() as db:
            accepted = get_context().deliveries.mail.sent(
                db, outbox_uuid, provider_message_id, lease=payload.lease
            )
            db.commit()
        if not accepted:
            return {"status": "stale", "outbox_uuid": outbox_uuid}
        operation_logger(
            "mail.sent",
            **context,
            status="sent",
        ).info("mail.sent")
        return {"status": "sent", "outbox_uuid": outbox_uuid}
    finally:
        if trace_scope is not None:
            trace_scope.__exit__(*sys.exc_info())
        clear_task_context()
