"""Ephemeral latency hints for work already durably admitted by a revision transaction."""

from dataclasses import dataclass

from app.core.logger import logger


@dataclass(frozen=True)
class RevisionPostCommitWork:
    score_id: int
    revision_id: int
    render_outbox_uuid: str
    playback_outbox_uuid: str
    metadata_outbox_uuid: str


class RevisionPostCommitCoordinator:
    def dispatch_best_effort(self, work: RevisionPostCommitWork) -> None:
        try:
            from app.modules.revisions.render_dispatch import dispatch_score_revision_render

            dispatch_score_revision_render(work.render_outbox_uuid)
        except Exception as exc:
            _log_failure(work, "revision_render", work.render_outbox_uuid, exc)

        try:
            from app.modules.playback.dispatch import dispatch_playback_outbox

            dispatch_playback_outbox(work.playback_outbox_uuid)
        except Exception as exc:
            _log_failure(work, "playback", work.playback_outbox_uuid, exc)

        try:
            from app.modules.revisions.metadata_dispatch import dispatch_revision_metadata

            dispatch_revision_metadata(work.metadata_outbox_uuid)
        except Exception as exc:
            _log_failure(work, "revision_metadata", work.metadata_outbox_uuid, exc)


def _log_failure(
    work: RevisionPostCommitWork, operation_kind: str, outbox_id: str, exc: Exception
) -> None:
    logger.bind(
        event="revision_post_commit.fast_dispatch_failed",
        score_id=work.score_id,
        revision_id=work.revision_id,
        outbox_id=outbox_id,
        operation_kind=operation_kind,
        exception_type=type(exc).__name__,
    ).warning("revision_post_commit.fast_dispatch_failed")


revision_post_commit = RevisionPostCommitCoordinator()
