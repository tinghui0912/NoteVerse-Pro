from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.db.models import PracticeSession


class PracticeRepository:
    """Repository boundary for practice-session persistence."""

    async def create_session(
        self,
        db: AsyncSession,
        session: PracticeSession,
    ) -> PracticeSession:
        db.add(session)
        await db.commit()
        await db.refresh(session)
        return session

    async def get_session_by_uuid(
        self,
        db: AsyncSession,
        session_uuid: str,
    ) -> PracticeSession | None:
        result = await db.exec(
            select(PracticeSession).where(PracticeSession.session_uuid == session_uuid)
        )
        return result.one_or_none()

    async def save_session(
        self,
        db: AsyncSession,
        session: PracticeSession,
    ) -> PracticeSession:
        db.add(session)
        await db.commit()
        await db.refresh(session)
        return session

    async def save_report(
        self,
        db: AsyncSession,
        session: PracticeSession,
    ) -> PracticeSession:
        db.add(session)
        await db.commit()
        await db.refresh(session)
        return session
