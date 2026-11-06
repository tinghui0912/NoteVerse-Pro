from __future__ import annotations

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from app.db.models.performance_take_manifest import PerformanceTakeManifest

from app.db.models.performance_take import PerformanceTake
from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation
from app.db.models.performance_take_delete_outbox import PerformanceTakeDeleteOutbox


class PerformanceTakeRepository:
    async def create_manifest(
        self, db: AsyncSession, manifest: PerformanceTakeManifest
    ) -> PerformanceTakeManifest:
        db.add(manifest)
        await db.flush()
        return manifest

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
        statement = (
            select(PerformanceTake)
            .join(PerformanceTakeManifest)
            .options(selectinload(PerformanceTake.manifest))
            .where(
                PerformanceTakeManifest.user_id == user_id,
                PerformanceTakeManifest.take_uuid == take_uuid,
            )
        )
        if lock:
            statement = statement.with_for_update(of=PerformanceTake)
        result = await db.execute(statement)
        return result.scalars().first()

    async def get_by_reservation(
        self,
        db: AsyncSession,
        user_id: int,
        reservation_id: int,
    ) -> Optional[PerformanceTake]:
        statement = (
            select(PerformanceTake)
            .join(PerformanceTakeManifest)
            .options(selectinload(PerformanceTake.manifest))
            .where(
                PerformanceTakeManifest.user_id == user_id,
                PerformanceTake.manifest_id
                == select(PerformanceTakeUploadReservation.manifest_id)
                .where(
                    PerformanceTakeUploadReservation.id == reservation_id,
                    PerformanceTakeUploadReservation.user_id == user_id,
                )
                .scalar_subquery(),
            )
            .execution_options(populate_existing=True)
        )
        result = await db.execute(statement)
        return result.scalars().first()

    async def list_takes(
        self,
        db: AsyncSession,
        user_id: int,
        linked_score_id: Optional[int] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> tuple[list[PerformanceTake], int]:
        filters = [PerformanceTakeManifest.user_id == user_id]
        if linked_score_id is not None:
            filters.append(PerformanceTake.linked_score_id == linked_score_id)

        count_stmt = (
            select(func.count(PerformanceTake.id)).join(PerformanceTakeManifest).where(*filters)
        )
        count_res = await db.execute(count_stmt)
        total = count_res.scalar_one_or_none() or 0

        statement = (
            select(PerformanceTake)
            .join(PerformanceTakeManifest)
            .options(selectinload(PerformanceTake.manifest))
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

    # Reservation methods
    async def create_reservation(
        self,
        db: AsyncSession,
        reservation: PerformanceTakeUploadReservation,
        *,
        auto_commit: bool = True,
    ) -> PerformanceTakeUploadReservation:
        db.add(reservation)
        if auto_commit:
            await db.commit()
            await db.refresh(reservation)
        else:
            await db.flush()
        return reservation

    async def get_reservation_by_client_request_id(
        self,
        db: AsyncSession,
        user_id: int,
        client_request_id: str,
        *,
        lock: bool = False,
    ) -> Optional[PerformanceTakeUploadReservation]:
        statement = (
            select(PerformanceTakeUploadReservation)
            .options(selectinload(PerformanceTakeUploadReservation.manifest))
            .where(
                PerformanceTakeUploadReservation.user_id == user_id,
                PerformanceTakeUploadReservation.client_request_id == client_request_id,
            )
        )
        statement = statement.execution_options(populate_existing=True)
        if lock:
            statement = statement.with_for_update()
        result = await db.execute(statement)
        return result.scalars().first()

    async def get_reservation_by_take_uuid(
        self,
        db: AsyncSession,
        user_id: int,
        take_uuid: str,
        *,
        lock: bool = False,
    ) -> Optional[PerformanceTakeUploadReservation]:
        statement = (
            select(PerformanceTakeUploadReservation)
            .options(selectinload(PerformanceTakeUploadReservation.manifest))
            .where(
                PerformanceTakeUploadReservation.user_id == user_id,
                PerformanceTakeUploadReservation.manifest_id
                == select(PerformanceTakeManifest.id)
                .where(
                    PerformanceTakeManifest.take_uuid == take_uuid,
                    PerformanceTakeManifest.user_id == user_id,
                )
                .scalar_subquery(),
            )
        )
        statement = statement.execution_options(populate_existing=True)
        if lock:
            statement = statement.with_for_update()
        result = await db.execute(statement)
        return result.scalars().first()

    async def get_reservation_by_uuid(
        self,
        db: AsyncSession,
        user_id: int,
        reservation_uuid: str,
        *,
        lock: bool = False,
    ) -> Optional[PerformanceTakeUploadReservation]:
        statement = (
            select(PerformanceTakeUploadReservation)
            .options(selectinload(PerformanceTakeUploadReservation.manifest))
            .where(
                PerformanceTakeUploadReservation.user_id == user_id,
                PerformanceTakeUploadReservation.reservation_uuid == reservation_uuid,
            )
            .execution_options(populate_existing=True)
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
