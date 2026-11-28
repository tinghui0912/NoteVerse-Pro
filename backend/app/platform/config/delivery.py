"""Non-secret durable delivery policy composition."""

from app.platform.config.import_dispatch import ImportDispatchSettings
from app.platform.config.revision_render_delivery import RevisionRenderDeliverySettings
from app.platform.config.revision_metadata_delivery import RevisionMetadataDeliverySettings
from app.platform.config.playback_delivery import PlaybackDeliverySettings
from app.platform.config.mail_delivery import MailDeliverySettings
from app.platform.config.score_deletion_delivery import ScoreDeletionDeliverySettings
from app.platform.config.account_deletion import AccountDeletionSettings
from app.platform.config.stored_object_retirement import StoredObjectRetirementSettings
from app.platform.config.object_writes import ObjectWriteSettings
from app.platform.config.notification_lifecycle import NotificationLifecycleSettings
from app.platform.config.realtime_retention import RealtimeRetentionSettings


class DispatchDeliveryConfig(
    ImportDispatchSettings,
    RevisionRenderDeliverySettings,
    RevisionMetadataDeliverySettings,
    PlaybackDeliverySettings,
    MailDeliverySettings,
    ScoreDeletionDeliverySettings,
    AccountDeletionSettings,
    StoredObjectRetirementSettings,
    ObjectWriteSettings,
):
    pass


class DeliveryConfig(
    DispatchDeliveryConfig, NotificationLifecycleSettings, RealtimeRetentionSettings
):
    pass


class OpsDeliveryConfig(
    ImportDispatchSettings,
    RevisionRenderDeliverySettings,
    PlaybackDeliverySettings,
    MailDeliverySettings,
    ScoreDeletionDeliverySettings,
    AccountDeletionSettings,
    StoredObjectRetirementSettings,
):
    """Policies needed for operator retry admission and SQL projections."""
