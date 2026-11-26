"""Explicit application wiring of independent usage and quota authorities."""

from app.core.config import settings
from app.modules.media_storage.delivery import MediaDeliveryService, DeliveryPolicy
from sqlalchemy.orm import Session
from app.modules.storage_governance.quota.schemas import (
    StorageUsageRead,
    StorageUsageQuotaRead,
    StorageUsageBreakdownRead,
)
from app.modules.storage_governance.usage.contracts import counts_toward_quota
from app.modules.storage_governance.usage.domain import StorageUsageCategory
from app.modules.storage_governance.usage.service import StorageUsageService
from app.modules.storage_governance.usage.provisioning import provision_usage_account
from app.modules.storage_governance.quota.service import StorageQuotaService
from app.modules.storage_governance.quota.contracts import StorageQuotaReader
from app.modules.storage_governance.usage.contracts import StorageUsageReader
from app.modules.storage_governance.quota.expiry import StorageQuotaExpiry


from app.db.session import SessionLocal
from app.storage import ObjectStorage
from app.modules.media_storage.write_coordinator import ObjectWriteCoordinator, SessionFactory

storage_usage_service = StorageUsageService()

storage_quota_service = StorageQuotaService(storage_usage_service)
storage_quota_expiry = StorageQuotaExpiry(storage_quota_service)


def provision_storage_resources(db: Session, user_id: int) -> None:
    storage_quota_service.entitlements.provision(db, user_id)
    provision_usage_account(db, user_id)


def read_storage_usage(
    db: Session,
    user_id: int,
    *,
    quota_reader: StorageQuotaReader = storage_quota_service,
    usage_reader: StorageUsageReader = storage_usage_service,
) -> StorageUsageRead:
    """Compose the existing customer projection from independent domain readers."""

    quota = quota_reader.snapshot_user(db, user_id, lock=True)
    usage = usage_reader.snapshot_user(db, user_id)
    return StorageUsageRead(
        quota=StorageUsageQuotaRead(
            used_bytes=quota.used_bytes,
            reserved_bytes=quota.reserved_bytes,
            limit_bytes=quota.entitlement.limit_bytes,
            available_bytes=quota.available_bytes,
        ),
        breakdown=[
            StorageUsageBreakdownRead(
                category=category,
                used_bytes=usage.categories[category],
                reserved_bytes=quota.categories[category],
                counts_toward_quota=counts_toward_quota(category),
            )
            for category in StorageUsageCategory
        ],
    )


write_sessions: SessionFactory = SessionLocal


def build_object_write_coordinator(storage: ObjectStorage) -> ObjectWriteCoordinator:
    return ObjectWriteCoordinator(storage, write_sessions)


def build_media_delivery_service(storage: ObjectStorage) -> MediaDeliveryService:
    return MediaDeliveryService(
        storage,
        DeliveryPolicy(
            settings.OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS,
            settings.MEDIA_DELIVERY_CACHE_SECONDS,
            settings.MEDIA_DELIVERY_MAX_STREAM_MEDIA_BYTES,
        ),
    )
