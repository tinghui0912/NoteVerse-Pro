"""Ephemeral latency hints for work already durably admitted by a revision transaction."""

from dataclasses import dataclass
from collections.abc import Callable

from app.core.logger import logger


@dataclass(frozen=True)
class RevisionPostCommitWork:
    score_id: int
    revision_id: int
    render_outbox_uuid: str
    playback_outbox_uuid: str
    metadata_outbox_uuid: str


class RevisionPostCommitCoordinator:
    def __init__(
        self,
        render: Callable[[str], bool],
        playback: Callable[[str], bool],
        metadata: Callable[[str], bool],
    ) -> None:
        self.render, self.playback, self.metadata = render, playback, metadata

    def dispatch_best_effort(self, work: RevisionPostCommitWork) -> None:
        try:
            self.render(work.render_outbox_uuid)
        except Exception as exc:
            _log_failure(work, "revision_render", work.render_outbox_uuid, exc)

        try:
            self.playback(work.playback_outbox_uuid)
        except Exception as exc:
            _log_failure(work, "playback", work.playback_outbox_uuid, exc)

        try:
            self.metadata(work.metadata_outbox_uuid)
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
