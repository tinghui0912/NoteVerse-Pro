"""Policy inputs used by resource-service composition."""

from app.platform.config.storage import MediaStoragePolicyConfig, WorkDirectoryConfig
from app.platform.config.object_writes import ObjectWriteSettings
from app.platform.config.revision_render_delivery import RevisionRenderDeliverySettings
from app.platform.config.playback_delivery import PlaybackDeliverySettings
from app.platform.config.model_asset_delivery import ModelAssetDeliverySettings
from app.platform.config.import_dispatch import ImportDispatchSettings
from app.platform.config.score_deletion_delivery import ScoreDeletionDeliverySettings

from app.platform.config.stored_object_retirement import StoredObjectRetirementSettings


class ResourcePolicies(
    StoredObjectRetirementSettings,
    RevisionRenderDeliverySettings,
    PlaybackDeliverySettings,
    WorkDirectoryConfig,
    MediaStoragePolicyConfig,
    ObjectWriteSettings,
    ModelAssetDeliverySettings,
    ImportDispatchSettings,
    ScoreDeletionDeliverySettings,
):
    OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS: int = 900
