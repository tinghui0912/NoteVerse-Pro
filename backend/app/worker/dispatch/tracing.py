"""Trace-context lookup for relays of durable background operations."""

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db.models import ImportJob, MailOutbox, PlaybackOutbox, RenderOutbox


@dataclass(frozen=True)
class DurableTraceContext:
    traceparent: str | None
    tracestate: str | None


def import_trace_context(db: Session, job_uuid: str) -> DurableTraceContext:
    record = db.execute(
        select(ImportJob.traceparent, ImportJob.tracestate).where(ImportJob.job_uuid == job_uuid)
    ).one_or_none()
    return DurableTraceContext(*(record or (None, None)))


def render_trace_context(db: Session, outbox_uuid: str) -> DurableTraceContext:
    record = db.execute(
        select(RenderOutbox.traceparent, RenderOutbox.tracestate).where(
            RenderOutbox.outbox_uuid == outbox_uuid
        )
    ).one_or_none()
    return DurableTraceContext(*(record or (None, None)))


def playback_trace_context(db: Session, outbox_uuid: str) -> DurableTraceContext:
    record = db.execute(
        select(PlaybackOutbox.traceparent, PlaybackOutbox.tracestate).where(
            PlaybackOutbox.outbox_uuid == outbox_uuid
        )
    ).one_or_none()
    return DurableTraceContext(*(record or (None, None)))


def mail_trace_context(db: Session, outbox_uuid: str) -> DurableTraceContext:
    record = db.execute(
        select(MailOutbox.traceparent, MailOutbox.tracestate).where(MailOutbox.outbox_uuid == outbox_uuid)
    ).one_or_none()
    return DurableTraceContext(*(record or (None, None)))
