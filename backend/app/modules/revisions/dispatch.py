from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import uuid4

from sqlalchemy import select

from app.core.logger import logger
from app.db.models import PlaybackOutbox, RenderOutbox
from app.db.session import SessionLocal
from app.modules.playback.outbox_service import playback_outbox_service
from app.modules.score_assets.render_outbox_service import render_outbox_service
from app.task_queue.producer import send_durable_task
from app.task_queue.tracing import playback_trace_context, render_trace_context

if TYPE_CHECKING:
    from app.modules.revisions.derivatives import RevisionDerivativeOutboxes


def dispatch_render_outbox(outbox_uuid: str) -> bool:
    task_id = uuid4().hex
    with SessionLocal() as db:
        if not render_outbox_service.mark_dispatched(db, outbox_uuid):
            db.commit()
            return False
        trace_context = render_trace_context(db, outbox_uuid)
        owner = db.execute(
            select(RenderOutbox.score_id, RenderOutbox.revision_id).where(
                RenderOutbox.outbox_uuid == outbox_uuid
            )
        ).one()
        db.commit()

    return send_durable_task(
        task_name="app.worker.tasks.render_outbox_task",
        task_kwargs={"outbox_uuid": outbox_uuid},
        task_id=task_id,
        operation_kind="render",
        operation_id=outbox_uuid,
        span_name="noteverse.render.dispatch",
        success_event="render.dispatched",
        failure_event="revision_derivative.fast_dispatch_failed",
        log_context={
            "outbox_id": outbox_uuid,
            "score_id": owner.score_id,
            "revision_id": owner.revision_id,
        },
        trace_context=trace_context,
        release_dispatch=lambda error: _release_render_dispatch(outbox_uuid, error),
    )


def _release_render_dispatch(outbox_uuid: str, error: str) -> None:
    with SessionLocal() as db:
        render_outbox_service.release_dispatch(db, outbox_uuid, error)
        db.commit()


def dispatch_playback_outbox(outbox_uuid: str) -> bool:
    task_id = uuid4().hex
    with SessionLocal() as db:
        if not playback_outbox_service.mark_dispatched(db, outbox_uuid):
            db.commit()
            return False
        trace_context = playback_trace_context(db, outbox_uuid)
        owner = db.execute(
            select(PlaybackOutbox.score_id, PlaybackOutbox.revision_id).where(
                PlaybackOutbox.outbox_uuid == outbox_uuid
            )
        ).one()
        db.commit()

    return send_durable_task(
        task_name="app.worker.tasks.playback_outbox_task",
        task_kwargs={"outbox_uuid": outbox_uuid},
        task_id=task_id,
        operation_kind="playback",
        operation_id=outbox_uuid,
        span_name="noteverse.playback.dispatch",
        success_event="playback.dispatched",
        failure_event="revision_derivative.fast_dispatch_failed",
        log_context={
            "outbox_id": outbox_uuid,
            "score_id": owner.score_id,
            "revision_id": owner.revision_id,
        },
        trace_context=trace_context,
        release_dispatch=lambda error: _release_playback_dispatch(outbox_uuid, error),
    )


def _release_playback_dispatch(outbox_uuid: str, error: str) -> None:
    with SessionLocal() as db:
        playback_outbox_service.release_dispatch(db, outbox_uuid, error)
        db.commit()


def dispatch_revision_derivatives_best_effort(work: RevisionDerivativeOutboxes) -> None:
    for asset_kind, outbox_id, dispatch in (
        ("render", work.render_outbox_uuid, dispatch_render_outbox),
        ("audio", work.playback_outbox_uuid, dispatch_playback_outbox),
    ):
        try:
            dispatch(outbox_id)
        except Exception as exc:
            logger.bind(
                event="revision_derivative.fast_dispatch_failed",
                score_id=work.score_id,
                revision_id=work.revision_id,
                outbox_id=outbox_id,
                operation_kind=asset_kind,
                exception_type=type(exc).__name__,
            ).warning("revision_derivative.fast_dispatch_failed")
