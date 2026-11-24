"""Explicit application composition of domain-owned semantic inventory providers."""

from app.modules.import_jobs.storage_inventory import ImportJobStorageInventoryProvider
from app.modules.performance_takes.storage_inventory import PerformanceTakeStorageInventoryProvider
from app.modules.revisions.storage_inventory import RevisionStorageInventoryProvider
from app.modules.score_assets.storage_inventory import ScoreAssetStorageInventoryProvider
from app.modules.scores.storage_inventory import ScoreInputStorageInventoryProvider
from app.modules.uploads.storage_inventory import UploadStorageInventoryProvider
from app.modules.storage_inventory.registry import StorageInventoryRegistry


def build_storage_inventory_registry() -> StorageInventoryRegistry:
    return StorageInventoryRegistry(
        (
            RevisionStorageInventoryProvider(),
            ScoreAssetStorageInventoryProvider(),
            ScoreInputStorageInventoryProvider(),
            UploadStorageInventoryProvider(),
            ImportJobStorageInventoryProvider(),
            PerformanceTakeStorageInventoryProvider(),
        )
    )
