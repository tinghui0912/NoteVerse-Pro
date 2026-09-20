from __future__ import annotations

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.performance_take import PerformanceTake


class PerformanceTakeRepository:
    async def create_take(self, db: AsyncSession, take: PerformanceTake) -> PerformanceTake:
        db.add(take)
        await db.commit()
        await db.refresh(take)
        return take

    async def get_by_uuid(
        self,
        db: AsyncSession,
        user_id: int,
        take_uuid: str,
    ) -> Optional[PerformanceTake]:
        statement = select(PerformanceTake).where(
            PerformanceTake.user_id == user_id,
            PerformanceTake.take_uuid == take_uuid,
        )
        result = await db.execute(statement)
        return result.scalars().first()

    async def get_by_client_request_id(
        self,
        db: AsyncSession,
        user_id: int,
        client_request_id: str,
    ) -> Optional[PerformanceTake]:
        statement = select(PerformanceTake).where(
            PerformanceTake.user_id == user_id,
            PerformanceTake.client_request_id == client_request_id,
        )
        result = await db.execute(statement)
        return result.scalars().first()

    async def list_takes(
        self,
        db: AsyncSession,
        user_id: int,
        score_id: Optional[int] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[PerformanceTake], int]:
        filters = [PerformanceTake.user_id == user_id]
        if score_id is not None:
            filters.append(PerformanceTake.score_id == score_id)

        count_stmt = select(func.count(PerformanceTake.id)).where(*filters)
        count_res = await db.execute(count_stmt)
        total = count_res.scalar_one_or_none() or 0

        statement = (
            select(PerformanceTake)
            .where(*filters)
            .order_by(PerformanceTake.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await db.execute(statement)
        items = list(result.scalars().all())
        return items, total

    async def delete_take(self, db: AsyncSession, take: PerformanceTake) -> None:
        await db.delete(take)
        await db.commit()
