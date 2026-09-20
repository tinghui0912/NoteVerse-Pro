from __future__ import annotations

from fastapi import Depends

from app.modules.performance_takes.repository import PerformanceTakeRepository
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.storage_usage.dependencies import get_storage_usage_service
from app.modules.storage_usage.service import StorageUsageService
from app.storage.base import FileStorage
from app.storage.factory import get_file_storage


def get_performance_take_repository() -> PerformanceTakeRepository:
    return PerformanceTakeRepository()


def get_performance_take_service(
    repository: PerformanceTakeRepository = Depends(get_performance_take_repository),
    storage: FileStorage = Depends(get_file_storage),
    storage_usage_service: StorageUsageService = Depends(get_storage_usage_service),
) -> PerformanceTakeService:
    return PerformanceTakeService(
        repository=repository,
        storage=storage,
        storage_usage_service=storage_usage_service,
    )
