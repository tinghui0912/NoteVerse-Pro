"""Fixture composition for exercising reservation and finalization through one test handle."""

from app.modules.performance_takes.upload_reservation.reservation_service import (
    PerformanceTakeReservationService,
)
from app.modules.performance_takes.finalization import PerformanceTakeFinalizationService


class TakeLifecycleServices:
    def __init__(
        self,
        *,
        repository=None,
        storage=None,
        storage_usage_service=None,
        score_access_policy=None,
        practice_bundle_service=None,
    ):
        from app.composition import storage_resources as resources
        from app.storage import object_storage as provider
        from app.composition.media_resources import build_practice_bundle_service
        from app.modules.storage_governance.quota.service import StorageQuotaService

        storage = storage if storage is not None else provider
        usage = (
            storage_usage_service
            if storage_usage_service is not None
            else resources.storage_usage_service
        )
        quota = StorageQuotaService(usage)
        delivery = resources.build_media_delivery_service(storage)
        bundle = (
            practice_bundle_service
            if practice_bundle_service is not None
            else build_practice_bundle_service(storage)
        )
        self.reservations = PerformanceTakeReservationService(
            repository=repository,
            storage=storage,
            storage_usage_service=usage,
            score_access_policy=score_access_policy,
            practice_bundle_service=bundle,
            quota=quota,
            delivery=delivery,
        )
        self.finalization = PerformanceTakeFinalizationService(
            repository=self.reservations.repository,
            storage=storage,
            storage_usage_service=usage,
            quota=quota,
            delivery=delivery,
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

    def reserve_upload(self, *args, **kwargs):
        return self.reservations.reserve_upload(*args, **kwargs)

    def cancel_upload_reservation(self, *args, **kwargs):
        return self.reservations.cancel_upload_reservation(*args, **kwargs)

    def finalize_take(self, *args, **kwargs):
        return self.finalization.finalize_take(*args, **kwargs)
