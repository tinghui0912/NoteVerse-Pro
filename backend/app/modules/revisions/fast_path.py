"""Recoverable latency hints; no revision correctness depends on these attempts."""

from app.core.logger import logger
from app.db.session import SessionLocal
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

    def run():
        from app.modules.revisions.metadata_dispatch import dispatch_revision_metadata
        from app.modules.revisions.projections import catch_up_revision_projections

        if result.metadata_outbox_uuid:
            try:
                dispatch_revision_metadata(result.metadata_outbox_uuid)
            except Exception as exc:
                logger.bind(
                    event="revision_metadata.fast_path_failed", error_class=type(exc).__name__
                ).warning("revision_metadata.fast_path_failed")
        try:
            with SessionLocal() as db:
                catch_up_revision_projections(db)
                db.commit()
        except Exception as exc:
            logger.bind(
                event="revision_projection.fast_path_failed", error_class=type(exc).__name__
            ).warning("revision_projection.fast_path_failed")

    try:
        run()
    except Exception as exc:
        logger.bind(event="revision.fast_path_failed", error_class=type(exc).__name__).warning(
            "revision.fast_path_failed"
        )
