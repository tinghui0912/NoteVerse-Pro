from __future__ import annotations

import asyncio
from dataclasses import dataclass

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import Session

from app.core.logger import logger
from app.modules.metadata.service import MetadataProjectionService
from app.modules.playback.outbox_service import (
    create_playback_outbox,
    create_playback_outbox_sync,
)
from app.modules.score_assets.render_outbox_service import (
    create_revision_render_outbox,
    create_revision_render_outbox_sync,
)
from app.storage import ObjectStorage, object_storage


@dataclass(frozen=True)
class RevisionDerivativeOutboxes:
    score_id: int
    revision_id: int
    render_outbox_uuid: str
    playback_outbox_uuid: str


class RevisionDerivativeService:
    async def enqueue(
        self,
        db: AsyncSession,
        *,
        score_id: int,
        revision_id: int,
        requested_by_user_id: int,
        source_fingerprint: str,
    ) -> RevisionDerivativeOutboxes:
        render = await create_revision_render_outbox(
            db,
            score_id=score_id,
            revision_id=revision_id,
            requested_by_user_id=requested_by_user_id,
            source_fingerprint=source_fingerprint,
        )
        playback = await create_playback_outbox(
            db,
            score_id=score_id,
            revision_id=revision_id,
            requested_by_user_id=requested_by_user_id,
            source_fingerprint=source_fingerprint,
        )

        return RevisionDerivativeOutboxes(
            score_id, revision_id, render.outbox_uuid, playback.outbox_uuid
        )

    def enqueue_sync(
        self,
        db: Session,
        *,
        score_id: int,
        revision_id: int,
        requested_by_user_id: int,
        source_fingerprint: str,
    ) -> RevisionDerivativeOutboxes:
        render = create_revision_render_outbox_sync(
            db,
            score_id=score_id,
            revision_id=revision_id,
            requested_by_user_id=requested_by_user_id,
            source_fingerprint=source_fingerprint,
        )
        audio = create_playback_outbox_sync(
            db,
            score_id=score_id,
            revision_id=revision_id,
            requested_by_user_id=requested_by_user_id,
            source_fingerprint=source_fingerprint,
        )
        return RevisionDerivativeOutboxes(
            score_id, revision_id, render.outbox_uuid, audio.outbox_uuid
        )

    def dispatch_after_commit_sync(self, work: RevisionDerivativeOutboxes) -> None:
        try:
            from app.modules.revisions.dispatch import dispatch_revision_derivatives_best_effort

            dispatch_revision_derivatives_best_effort(work)
        except Exception as exc:
            _log_fast_dispatch_failure(work, exc)

    async def dispatch_after_commit(self, work: RevisionDerivativeOutboxes) -> None:
        try:
            from app.modules.revisions.dispatch import dispatch_revision_derivatives_best_effort

            await asyncio.to_thread(dispatch_revision_derivatives_best_effort, work)
        except Exception as exc:
            _log_fast_dispatch_failure(work, exc)

    async def rebuild_metadata_best_effort(
        self,
        db: AsyncSession,
        *,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
        storage: ObjectStorage | None = None,
    ) -> None:
        try:
            await MetadataProjectionService(storage=storage or object_storage).rebuild(
                db, score_uuid, revision_uuid, user_id
            )
        except Exception:
            await db.rollback()


def _log_fast_dispatch_failure(work: RevisionDerivativeOutboxes, exc: Exception) -> None:
    for kind, outbox_id in (
        ("render", work.render_outbox_uuid),
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
