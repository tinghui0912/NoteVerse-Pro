"""Fixture composition for exercising reservation and finalization through one test handle."""

from app.modules.performance_takes.upload_reservation.reservation_service import (
    PerformanceTakeReservationService,
)
from app.modules.performance_takes.finalization import PerformanceTakeFinalizationService


class TakeLifecycleServices:
    def __init__(self, **kwargs):
        self.reservations = PerformanceTakeReservationService(**kwargs)
        self.finalization = PerformanceTakeFinalizationService(
            repository=self.reservations.repository,
            storage=self.reservations.storage,
            storage_usage_service=self.reservations.storage_usage_service,
        )

    @property
    def repository(self):
        return self.reservations.repository

    @repository.setter
    def repository(self, value):
        self.reservations.repository = value
        self.finalization.repository = value
        self.finalization.writer.repository = value
        self.finalization.recovery.repository = value

    @property
    def takes(self):
        return self.reservations.takes

    @property
    def storage_usage_service(self):
        return self.reservations.storage_usage_service

    @property
    def practice_bundle_service(self):
        return self.reservations.practice_bundle_service

    async def reserve_upload(self, *args, **kwargs):
        return await self.reservations.reserve_upload(*args, **kwargs)

    async def cancel_upload_reservation(self, *args, **kwargs):
        return await self.reservations.cancel_upload_reservation(*args, **kwargs)

    async def finalize_take(self, *args, **kwargs):
        return await self.finalization.finalize_take(*args, **kwargs)
