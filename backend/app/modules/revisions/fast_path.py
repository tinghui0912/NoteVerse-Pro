"""Recoverable latency hints; no revision correctness depends on these attempts."""

from app.core.logger import logger
from app.modules.revisions.writer import RevisionWriteResult
from app.modules.revisions.derivatives import revision_derivative_service


def revision_fast_path(result: RevisionWriteResult) -> None:
    if not result.created:
        return
    if result.derivatives is not None:
        try:
            revision_derivative_service.dispatch_after_commit(result.derivatives)
        except Exception as exc:
            logger.bind(
                event="revision_derivative.fast_path_failed", error_class=type(exc).__name__
            ).warning("revision_derivative.fast_path_failed")

    if result.metadata_outbox_uuid:
        from app.modules.revisions.metadata_dispatch import dispatch_revision_metadata

        try:
            dispatch_revision_metadata(result.metadata_outbox_uuid)
        except Exception as exc:
            logger.bind(
                event="revision_metadata.fast_path_failed", error_class=type(exc).__name__
            ).warning("revision_metadata.fast_path_failed")
