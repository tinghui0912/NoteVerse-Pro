from __future__ import annotations

from dataclasses import dataclass


from app.core.logger import logger


@dataclass(frozen=True)
class RevisionDerivativeOutboxes:
    score_id: int
    revision_id: int
    revision_render_outbox_uuid: str
    playback_outbox_uuid: str


class RevisionDerivativeService:
    def dispatch_after_commit(self, work: RevisionDerivativeOutboxes) -> None:
        try:
            from app.modules.revisions.dispatch import dispatch_revision_derivatives_best_effort

            dispatch_revision_derivatives_best_effort(work)
        except Exception as exc:
            _log_fast_dispatch_failure(work, exc)


def _log_fast_dispatch_failure(work: RevisionDerivativeOutboxes, exc: Exception) -> None:
    for kind, outbox_id in (
        ("revision_render", work.revision_render_outbox_uuid),
        ("playback", work.playback_outbox_uuid),
    ):
        logger.bind(
            event="revision_derivative.fast_dispatch_failed",
            score_id=work.score_id,
            revision_id=work.revision_id,
            outbox_id=outbox_id,
            operation_kind=kind,
            exception_type=type(exc).__name__,
        ).warning("revision_derivative.fast_dispatch_failed")


revision_derivative_service = RevisionDerivativeService()
