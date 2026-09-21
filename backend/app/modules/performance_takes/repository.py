from __future__ import annotations

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models.performance_take import PerformanceTake
from app.db.models.performance_take_upload_authorization import PerformanceTakeUploadAuthorization
from app.db.models.performance_take_delete_outbox import PerformanceTakeDeleteOutbox


class PerformanceTakeRepository:
    async def create_take(
        self,
        db: AsyncSession,
        take: PerformanceTake,
        *,
        auto_commit: bool = True,
    ) -> PerformanceTake:
        db.add(take)
        if auto_commit:
            await db.commit()
            await db.refresh(take)
        else:
            await db.flush()
        return take

    async def get_by_uuid(
        self,
        db: AsyncSession,
        user_id: int,
        take_uuid: str,
        *,
        lock: bool = False,
    ) -> Optional[PerformanceTake]:
        statement = select(PerformanceTake).where(
            PerformanceTake.user_id == user_id,
            PerformanceTake.take_uuid == take_uuid,
        )
        if lock:
            statement = statement.with_for_update()
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
            .order_by(PerformanceTake.created_at.desc(), PerformanceTake.id.desc())
            .limit(limit)
            .offset(offset)
        )
        result = await db.execute(statement)
        items = list(result.scalars().all())
        return items, total

    async def delete_take(
        self,
        db: AsyncSession,
        take: PerformanceTake,
        *,
        auto_commit: bool = True,
    ) -> None:
        await db.delete(take)
        if auto_commit:
            await db.commit()

    # Authorization methods
    async def create_authorization(
        self,
        db: AsyncSession,
        auth: PerformanceTakeUploadAuthorization,
        *,
        auto_commit: bool = True,
    ) -> PerformanceTakeUploadAuthorization:
        db.add(auth)
        if auto_commit:
            await db.commit()
            await db.refresh(auth)
        else:
            await db.flush()
        return auth

    async def get_authorization_by_client_request_id(
        self,
        db: AsyncSession,
        user_id: int,
        client_request_id: str,
        *,
        lock: bool = False,
    ) -> Optional[PerformanceTakeUploadAuthorization]:
        statement = select(PerformanceTakeUploadAuthorization).where(
            PerformanceTakeUploadAuthorization.user_id == user_id,
            PerformanceTakeUploadAuthorization.client_request_id == client_request_id,
        )
        if lock:
            statement = statement.with_for_update()
        result = await db.execute(statement)
        return result.scalars().first()

    async def get_authorization_by_take_uuid(
        self,
        db: AsyncSession,
        user_id: int,
        take_uuid: str,
        *,
        lock: bool = False,
    ) -> Optional[PerformanceTakeUploadAuthorization]:
        statement = select(PerformanceTakeUploadAuthorization).where(
            PerformanceTakeUploadAuthorization.user_id == user_id,
            PerformanceTakeUploadAuthorization.take_uuid == take_uuid,
        )
        if lock:
            statement = statement.with_for_update()
        result = await db.execute(statement)
        return result.scalars().first()

    # Outbox methods
    async def create_delete_outbox(
        self,
        db: AsyncSession,
        outbox: PerformanceTakeDeleteOutbox,
        *,
        auto_commit: bool = True,
    ) -> PerformanceTakeDeleteOutbox:
        db.add(outbox)
        if auto_commit:
            await db.commit()
            await db.refresh(outbox)
        else:
            await db.flush()
        return outbox

    async def get_delete_outbox_by_take_uuid(
        self,
        db: AsyncSession,
        take_uuid: str,
        *,
        lock: bool = False,
    ) -> Optional[PerformanceTakeDeleteOutbox]:
        statement = select(PerformanceTakeDeleteOutbox).where(
            PerformanceTakeDeleteOutbox.take_uuid == take_uuid,
        )
        if lock:
            statement = statement.with_for_update()
        result = await db.execute(statement)
        return result.scalars().first()
