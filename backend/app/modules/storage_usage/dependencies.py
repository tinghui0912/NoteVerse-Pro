from app.modules.storage_usage.service import StorageUsageService, storage_usage_service


def get_storage_usage_service() -> StorageUsageService:
    return storage_usage_service
