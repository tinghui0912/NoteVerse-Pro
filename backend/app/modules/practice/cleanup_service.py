from __future__ import annotations

from sqlalchemy import delete as sa_delete, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import PracticeSession


class PracticeCleanupService:
    """Cleanup boundary for practice sessions and their future stored assets."""

    async def cleanup_for_score(self, db: AsyncSession, score_id: int) -> list[str]:
        sessions = list(
            (
                await db.execute(
                    select(PracticeSession).where(PracticeSession.score_id == score_id)
                )
            ).scalars().all()
        )
        storage_keys = [
            session.audio_path
            for session in sessions
            if session.audio_path is not None
        ]
        await db.execute(sa_delete(PracticeSession).where(PracticeSession.score_id == score_id))
        await db.flush()
        return storage_keys


practice_cleanup_service = PracticeCleanupService()
