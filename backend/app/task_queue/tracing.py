"""Trace-context lookup for relays of durable background operations."""

from dataclasses import dataclass
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ImportJob, MailOutbox, PlaybackOutbox, RenderOutbox


@dataclass(frozen=True)
class DurableTraceContext:
    traceparent: str | None
    tracestate: str | None


def import_trace_context(db: Session, job_uuid: str) -> DurableTraceContext:
    return _trace_context_for(
        db,
        traceparent_column=ImportJob.traceparent,
        tracestate_column=ImportJob.tracestate,
        identity_filter=ImportJob.job_uuid == job_uuid,
    )


def render_trace_context(db: Session, outbox_uuid: str) -> DurableTraceContext:
    return _trace_context_for(
        db,
        traceparent_column=RenderOutbox.traceparent,
        tracestate_column=RenderOutbox.tracestate,
        identity_filter=RenderOutbox.outbox_uuid == outbox_uuid,
    )


def playback_trace_context(db: Session, outbox_uuid: str) -> DurableTraceContext:
    return _trace_context_for(
        db,
        traceparent_column=PlaybackOutbox.traceparent,
        tracestate_column=PlaybackOutbox.tracestate,
        identity_filter=PlaybackOutbox.outbox_uuid == outbox_uuid,
    )


def mail_trace_context(db: Session, outbox_uuid: str) -> DurableTraceContext:
    return _trace_context_for(
        db,
        traceparent_column=MailOutbox.traceparent,
        tracestate_column=MailOutbox.tracestate,
        identity_filter=MailOutbox.outbox_uuid == outbox_uuid,
    )


def _trace_context_for(
    db: Session,
    *,
    traceparent_column: Any,
    tracestate_column: Any,
    identity_filter: Any,
) -> DurableTraceContext:
    record = db.execute(
        select(traceparent_column, tracestate_column).where(identity_filter)
    ).one_or_none()
    if record is None:
        return DurableTraceContext(traceparent=None, tracestate=None)
    return DurableTraceContext(traceparent=record[0], tracestate=record[1])
