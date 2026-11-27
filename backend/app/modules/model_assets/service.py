"""Authenticated delivery of the configured acoustic model through ObjectStorage."""

from app.platform.config.model_asset_delivery import ModelAssetDeliverySettings

from app.modules.media_storage.delivery import MediaDeliveryService, SystemObjectDelivery

from datetime import timedelta
from app.modules.model_assets.schemas import PracticeAcousticAccessRead
from app.modules.model_assets.generated.practice_acoustic_model_asset import (
    MODEL_ASSET,
    MODEL_ASSET_DESCRIPTOR,
)
from app.shared.time import utc_now


class ModelAssetService:
    def __init__(
        self,
        ttl_seconds: int | None = None,
        *,
        delivery: MediaDeliveryService,
        config: ModelAssetDeliverySettings,
    ) -> None:
        self.config = config
        self.delivery = delivery
        self.storage = delivery.storage
        self.ttl_seconds = (
            ttl_seconds
            if ttl_seconds is not None
            else self.config.MODEL_ASSET_SIGNED_GET_TTL_SECONDS
        )

    def get_practice_acoustic_access(self) -> PracticeAcousticAccessRead:
        return PracticeAcousticAccessRead.model_validate(
            {
                **MODEL_ASSET_DESCRIPTOR,
                "downloadUrl": (
                    self.delivery.signed_url(
                        SystemObjectDelivery(
                            MODEL_ASSET.storage_key,
                            MODEL_ASSET.byte_size,
                            MODEL_ASSET.media_type,
                            MODEL_ASSET.storage_key.rsplit("/", 1)[-1],
                        ),
                        expires_seconds=self.ttl_seconds,
                    )
                ),
                "downloadUrlExpiresAt": utc_now() + timedelta(seconds=self.ttl_seconds),
            }
        )
