"""Construct each domain delivery authority from explicit non-secret policies."""

from dataclasses import dataclass
from app.platform.config.delivery import DeliveryConfig, DispatchDeliveryConfig, OpsDeliveryConfig
from app.modules.import_jobs.dispatch_service import ImportDispatchService
from app.platform.config.import_dispatch import ImportDispatchSettings
from app.modules.revisions.render_delivery import ScoreRevisionRenderDelivery
from app.platform.config.revision_render_delivery import RevisionRenderDeliverySettings
from app.modules.revisions.metadata_delivery import RevisionMetadataDelivery
from app.platform.config.revision_metadata_delivery import RevisionMetadataDeliverySettings
from app.modules.playback.outbox_service import PlaybackOutboxService
from app.platform.config.playback_delivery import PlaybackDeliverySettings
from app.modules.mail.outbox_service import MailOutboxService
from app.platform.config.mail_delivery import MailDeliverySettings
from app.modules.scores.deletion_delivery import ScoreDeletionDeliveryService
from app.platform.config.score_deletion_delivery import ScoreDeletionDeliverySettings
from app.modules.account.deletion_delivery import AccountDeletionDelivery
from app.platform.config.account_deletion import AccountDeletionSettings
from app.modules.media_storage.retirement import StoredObjectRetirementDelivery
from app.platform.config.stored_object_retirement import StoredObjectRetirementSettings
from app.modules.media_storage.write_cleanup import ObjectWriteCleanupDelivery
from app.platform.config.object_writes import ObjectWriteSettings
from app.modules.notifications.maintenance_service import NotificationMaintenanceService
from app.platform.config.notification_lifecycle import NotificationLifecycleSettings
from app.modules.realtime.maintenance_service import RealtimeMaintenanceService
from app.platform.config.realtime_retention import RealtimeRetentionSettings


@dataclass(frozen=True)
class DispatchDeliveries:
    imports: ImportDispatchService
    render: ScoreRevisionRenderDelivery
    metadata: RevisionMetadataDelivery
    playback: PlaybackOutboxService
    mail: MailOutboxService
    score_deletion: ScoreDeletionDeliveryService
    account_deletion: AccountDeletionDelivery
    retirement: StoredObjectRetirementDelivery
    write_cleanup: ObjectWriteCleanupDelivery


@dataclass(frozen=True)
class DeliveryServices(DispatchDeliveries):
    notifications: NotificationMaintenanceService
    realtime: RealtimeMaintenanceService


def build_dispatch_deliveries(config: DispatchDeliveryConfig) -> DispatchDeliveries:
    return DispatchDeliveries(
        imports=ImportDispatchService(
            config=ImportDispatchSettings.model_validate(config.model_dump())
        ),
        render=ScoreRevisionRenderDelivery(
            config=RevisionRenderDeliverySettings.model_validate(config.model_dump())
        ),
        metadata=RevisionMetadataDelivery(
            config=RevisionMetadataDeliverySettings.model_validate(config.model_dump())
        ),
        playback=PlaybackOutboxService(
            config=PlaybackDeliverySettings.model_validate(config.model_dump())
        ),
        mail=MailOutboxService(config=MailDeliverySettings.model_validate(config.model_dump())),
        score_deletion=ScoreDeletionDeliveryService(
            config=ScoreDeletionDeliverySettings.model_validate(config.model_dump())
        ),
        account_deletion=AccountDeletionDelivery(
            config=AccountDeletionSettings.model_validate(config.model_dump())
        ),
        retirement=StoredObjectRetirementDelivery(
            config=StoredObjectRetirementSettings.model_validate(config.model_dump())
        ),
        write_cleanup=ObjectWriteCleanupDelivery(
            config=ObjectWriteSettings.model_validate(config.model_dump())
        ),
    )


def build_delivery_services(config: DeliveryConfig) -> DeliveryServices:
    dispatch = build_dispatch_deliveries(config)
    return DeliveryServices(
        dispatch.imports,
        dispatch.render,
        dispatch.metadata,
        dispatch.playback,
        dispatch.mail,
        dispatch.score_deletion,
        dispatch.account_deletion,
        dispatch.retirement,
        dispatch.write_cleanup,
        notifications=NotificationMaintenanceService(
            config=NotificationLifecycleSettings.model_validate(config.model_dump())
        ),
        realtime=RealtimeMaintenanceService(
            config=RealtimeRetentionSettings.model_validate(config.model_dump())
        ),
    )


@dataclass(frozen=True)
class OpsDeliveries:
    imports: ImportDispatchService
    render: ScoreRevisionRenderDelivery
    playback: PlaybackOutboxService
    mail: MailOutboxService
    score_deletion: ScoreDeletionDeliveryService
    account_deletion: AccountDeletionDelivery
    retirement: StoredObjectRetirementDelivery


def build_ops_deliveries(config: OpsDeliveryConfig) -> OpsDeliveries:
    values = config.model_dump()
    return OpsDeliveries(
        ImportDispatchService(config=ImportDispatchSettings.model_validate(values)),
        ScoreRevisionRenderDelivery(config=RevisionRenderDeliverySettings.model_validate(values)),
        PlaybackOutboxService(config=PlaybackDeliverySettings.model_validate(values)),
        MailOutboxService(config=MailDeliverySettings.model_validate(values)),
        ScoreDeletionDeliveryService(config=ScoreDeletionDeliverySettings.model_validate(values)),
        AccountDeletionDelivery(config=AccountDeletionSettings.model_validate(values)),
        StoredObjectRetirementDelivery(
            config=StoredObjectRetirementSettings.model_validate(values)
        ),
    )
