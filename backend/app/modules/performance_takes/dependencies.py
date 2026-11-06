from __future__ import annotations

from fastapi import Depends

from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.performance_takes.upload_reservation.service import PerformanceTakeUploadService
from app.modules.storage_usage.dependencies import get_storage_usage_service
from app.modules.storage_usage.service import StorageUsageService
from app.storage.base import ObjectStorage
from app.storage.factory import get_object_storage


def get_performance_take_repository() -> PerformanceTakeRepository:
    return PerformanceTakeRepository()


def get_performance_take_service(
    repository: PerformanceTakeRepository = Depends(get_performance_take_repository),
    storage: ObjectStorage = Depends(get_object_storage),
) -> PerformanceTakeService:
    return PerformanceTakeService(
        repository=repository,
        storage=storage,
    )


def get_performance_take_upload_service(
    repository: PerformanceTakeRepository = Depends(get_performance_take_repository),
    storage: ObjectStorage = Depends(get_object_storage),
    storage_usage_service: StorageUsageService = Depends(get_storage_usage_service),
) -> PerformanceTakeUploadService:
    return PerformanceTakeUploadService(
        repository=repository, storage=storage, storage_usage_service=storage_usage_service
    )
