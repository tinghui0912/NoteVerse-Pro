from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession

from app.modules.score_assets.render_outbox_service import create_revision_render_outbox
from app.modules.metadata.service import MetadataProjectionService
from app.modules.playback.outbox_service import create_playback_outbox
from app.storage import FileStorage, file_storage


class RevisionDerivativeService:
    async def enqueue(
        self,
        db: AsyncSession,
        *,
        score_id: int,
        revision_id: int,
        requested_by_user_id: int,
        source_fingerprint: str,
    ) -> None:
        await create_revision_render_outbox(
            db,
            score_id=score_id,
            revision_id=revision_id,
            requested_by_user_id=requested_by_user_id,
            source_fingerprint=source_fingerprint,
        )
        await create_playback_outbox(
            db,
            score_id=score_id,
            revision_id=revision_id,
            requested_by_user_id=requested_by_user_id,
            source_fingerprint=source_fingerprint,
        )

    async def rebuild_metadata_best_effort(
        self,
        db: AsyncSession,
        *,
        score_uuid: str,
        revision_uuid: str,
        user_id: int,
        storage: FileStorage | None = None,
    ) -> None:
        try:
            await MetadataProjectionService(storage=storage or file_storage).rebuild(
                db, score_uuid, revision_uuid, user_id
            )
        except Exception:
            await db.rollback()


revision_derivative_service = RevisionDerivativeService()
