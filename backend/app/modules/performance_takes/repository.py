from __future__ import annotations

from typing import Optional

from sqlalchemy import func, select
from sqlalchemy.orm import Session
from sqlalchemy.orm import selectinload
from app.db.models.performance_take_manifest import PerformanceTakeManifest

from app.db.models.performance_take import PerformanceTake
from app.db.models.performance_take_upload_reservation import PerformanceTakeUploadReservation


class PerformanceTakeRepository:
    def create_manifest(
        self, db: Session, manifest: PerformanceTakeManifest
    ) -> PerformanceTakeManifest:
        db.add(manifest)
        db.flush()
        return manifest

    def create_take(
        self,
        db: Session,
        take: PerformanceTake,
    ) -> PerformanceTake:
        db.add(take)
        db.flush()
        return take

    def get_by_uuid(
        self,
        db: Session,
        user_id: int,
        take_uuid: str,
        *,
        lock: bool = False,
    ) -> Optional[PerformanceTake]:
        statement = (
            select(PerformanceTake)
            .join(PerformanceTakeManifest)
            .options(
                selectinload(PerformanceTake.manifest),
                selectinload(PerformanceTake.recording_object),
            )
            .where(
                PerformanceTakeManifest.user_id == user_id,
                PerformanceTakeManifest.take_uuid == take_uuid,
            )
        )
        if lock:
            statement = statement.with_for_update(of=PerformanceTake)
        result = db.execute(statement)
        return result.scalars().first()

    def get_by_reservation(
        self,
        db: Session,
        user_id: int,
        reservation_id: int,
    ) -> Optional[PerformanceTake]:
        statement = (
            select(PerformanceTake)
            .join(PerformanceTakeManifest)
            .options(
                selectinload(PerformanceTake.manifest),
                selectinload(PerformanceTake.recording_object),
            )
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
        result = db.execute(statement)
        return result.scalars().first()

    def list_takes(
        self,
        db: Session,
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
        count_res = db.execute(count_stmt)
        total = count_res.scalar_one_or_none() or 0

        statement = (
            select(PerformanceTake)
            .join(PerformanceTakeManifest)
            .options(
                selectinload(PerformanceTake.manifest),
                selectinload(PerformanceTake.recording_object),
            )
            .where(*filters)
            .order_by(PerformanceTake.created_at.desc(), PerformanceTake.id.desc())
            .limit(limit)
            .offset(offset)
        )
        result = db.execute(statement)
        items = list(result.scalars().all())
        return items, total

    # Reservation methods
    def create_reservation(
        self,
        db: Session,
        reservation: PerformanceTakeUploadReservation,
    ) -> PerformanceTakeUploadReservation:
        db.add(reservation)
        db.flush()
        return reservation

    def get_reservation_by_client_request_id(
        self,
        db: Session,
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
        result = db.execute(statement)
        return result.scalars().first()

    def get_reservation_by_take_uuid(
        self,
        db: Session,
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
        result = db.execute(statement)
        return result.scalars().first()

    def get_reservation_by_uuid(
        self,
        db: Session,
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
        result = db.execute(statement)
        return result.scalars().first()
