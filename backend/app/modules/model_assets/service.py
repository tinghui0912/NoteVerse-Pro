"""Authenticated delivery of the configured acoustic model through ObjectStorage."""

from datetime import timedelta
from functools import lru_cache
from app.core.config import settings
from app.modules.model_assets.schemas import PracticeAcousticAccessRead
from app.modules.model_assets.generated.practice_acoustic_contract import (
    MODEL_ASSET,
    MODEL_ASSET_DESCRIPTOR,
)
from app.storage import ObjectStorage, object_storage
from app.utils.timezone import utc_now


class ModelAssetService:
    def __init__(
        self, storage: ObjectStorage | None = None, ttl_seconds: int | None = None
    ) -> None:
        self.storage = storage or object_storage
        self.ttl_seconds = (
            ttl_seconds if ttl_seconds is not None else settings.MODEL_ASSET_SIGNED_GET_TTL_SECONDS
        )

    def get_practice_acoustic_access(self) -> PracticeAcousticAccessRead:
        return PracticeAcousticAccessRead.model_validate(
            {
                **MODEL_ASSET_DESCRIPTOR,
                "downloadUrl": self.storage.download_url(
                    MODEL_ASSET.storage_key, expires_seconds=self.ttl_seconds
                ),
                "downloadUrlExpiresAt": (utc_now() + timedelta(seconds=self.ttl_seconds))
                .isoformat()
                .replace("+00:00", "Z"),
            }
        )


@lru_cache(maxsize=1)
def get_model_asset_service() -> ModelAssetService:
    return ModelAssetService()
