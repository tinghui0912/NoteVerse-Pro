from __future__ import annotations

from sqlalchemy.ext.asyncio import AsyncSession
from sqlmodel import select

from app.db.models import PracticeSession, Share, Task
from app.db.models.file import File
from app.shared.file_kinds import FileKind


class PracticeRepository:
    """Repository boundary for practice-session persistence."""

    async def get_task_by_uuid(
        self,
        db: AsyncSession,
        task_uuid: str,
    ) -> Task | None:
        result = await db.exec(select(Task).where(Task.task_uuid == task_uuid))
        return result.one_or_none()

    async def get_task_by_id(
        self,
        db: AsyncSession,
        task_id: int,
    ) -> Task | None:
        result = await db.exec(select(Task).where(Task.id == task_id))
        return result.one_or_none()

    async def get_share_by_token(
        self,
        db: AsyncSession,
        share_token: str,
    ) -> Share | None:
        result = await db.exec(select(Share).where(Share.token == share_token))
        return result.one_or_none()

    async def get_task_file_by_kind(
        self,
        db: AsyncSession,
        task_id: int,
        kind: FileKind,
    ) -> File | None:
        result = await db.exec(
            select(File)
            .where(File.task_id == task_id)
            .where(File.kind == kind)
            .order_by(File.page_number)
        )
        return result.first()

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
