"""Explicit resource-service composition with process-owned dependencies."""

from app.modules.practice.bundle.retention import PracticeBundleRetention

from collections.abc import Callable
from app.modules.revisions.post_commit import RevisionPostCommitCoordinator
from app.modules.revisions.render_delivery import ScoreRevisionRenderDelivery
from app.modules.playback.outbox_service import PlaybackOutboxService
from app.platform.config.revision_render_delivery import RevisionRenderDeliverySettings
from app.platform.config.playback_delivery import PlaybackDeliverySettings
from app.platform.config.application import ImportExecutionConfig
from app.processing.engines.playback import FluidSynthAudioRenderer
from app.storage import ObjectStorage
from app.composition import storage_resources as resources
from app.modules.account.avatar_service import AvatarService
from app.modules.uploads.service import UploadService
from app.modules.revisions.service import RevisionService
from app.modules.revisions.writer import RevisionWriter
from app.modules.revisions.derived_asset_retention_service import DerivedAssetRetentionService
from app.modules.scores.input_asset_lifecycle import ScoreInputAssetLifecycle
from app.modules.scores.deletion_delivery import ScoreDeletionDeliveryService
from app.modules.scores.deletion_executor import ScoreDeletionExecutor
from app.modules.scores.service import ScoreService
from app.modules.scores.lifecycle_service import ScoreLifecycleService
from app.modules.score_assets.service import ScoreAssetService
from app.modules.score_assets.score_revision_rendering import ScoreRevisionRenderService
from app.modules.playback.service import PlaybackGenerationService
from app.modules.playback.delivery import PlaybackDeliveryService
from app.modules.guest_previews.service import GuestPreviewService
from app.modules.model_assets.service import ModelAssetService
from app.modules.import_jobs.service import ImportJobService
from app.modules.import_jobs.review.service import ImportReviewService
from app.modules.import_jobs.execution_recorder import ImportExecutionRecorder
from app.modules.import_jobs.pipeline_runner import ImportPipelineRunner
from app.modules.import_jobs.pipeline.artifact_recorder import ImportArtifactRecorder
from app.modules.import_jobs.maintenance_service import ImportJobMaintenanceService
from app.modules.import_jobs.deletion_service import ImportJobDeletionService
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.performance_takes.finalization import PerformanceTakeFinalizationService
from app.modules.performance_takes.upload_reservation.reservation_service import (
    PerformanceTakeReservationService,
)
from app.modules.practice.bundle.service import PracticeBundleService
from app.modules.media_storage.write_coordinator import ObjectWriteCoordinator, SessionFactory
from app.modules.media_storage.delivery import MediaDeliveryService, DeliveryPolicy
from app.modules.media_storage.upload_sessions.service import UploadSessionService
from app.modules.media_storage.upload_sessions.domain import UploadPolicy
from app.platform.config.resources import ResourcePolicies
from app.platform.config.object_writes import ObjectWriteSettings
from app.platform.config.model_asset_delivery import ModelAssetDeliverySettings
from app.platform.config.import_dispatch import ImportDispatchSettings
from app.platform.config.score_deletion_delivery import ScoreDeletionDeliverySettings
from app.platform.config.storage import MediaStoragePolicyConfig


class ResourceServices:
    def __init__(
        self,
        storage: ObjectStorage,
        sessions: SessionFactory,
        config: ResourcePolicies,
        post_commit: RevisionPostCommitCoordinator,
        score_dispatch: Callable[[str], None],
    ) -> None:
        self.storage, self.sessions, self.config = storage, sessions, config
        self.post_commit, self.score_dispatch = post_commit, score_dispatch

    def build_object_write_coordinator(self) -> ObjectWriteCoordinator:
        return ObjectWriteCoordinator(
            self.storage,
            self.sessions,
            config=ObjectWriteSettings.model_validate(self.config.model_dump()),
        )

    def build_media_delivery_service(self) -> MediaDeliveryService:
        return MediaDeliveryService(
            self.storage,
            DeliveryPolicy(
                self.config.OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS,
                self.config.MEDIA_DELIVERY_CACHE_SECONDS,
                self.config.MEDIA_DELIVERY_MAX_STREAM_MEDIA_BYTES,
            ),
        )

    def build_upload_session_service(self) -> UploadSessionService:
        p = self.config
        return UploadSessionService(
            self.storage,
            self.sessions,
            self.build_object_write_coordinator(),
            UploadPolicy(
                p.SCORE_IMPORT_MAX_BYTES,
                p.TAKE_AUDIO_MAX_BYTES,
                p.TAKE_VIDEO_MAX_BYTES,
                p.UPLOAD_SINGLE_PUT_MAX_BYTES,
                p.UPLOAD_PART_BYTES,
                p.UPLOAD_URL_TTL_SECONDS,
                p.UPLOAD_SESSION_TTL_SECONDS,
                p.UPLOAD_CLIENT_CONCURRENCY,
                p.UPLOAD_MAX_ACTIVE_SESSIONS,
                p.UPLOAD_TEMP_BYTE_BUDGET,
            ),
        )

    def build_avatar_service(self) -> AvatarService:
        return AvatarService(
            writes=self.build_object_write_coordinator(),
            delivery=self.build_media_delivery_service(),
            config=MediaStoragePolicyConfig.model_validate(self.config.model_dump()),
        )

    def build_upload_service(self) -> UploadService:
        return UploadService(
            uploads=self.build_upload_session_service(),
            usage=resources.storage_usage_service,
            quota=resources.storage_quota_service,
        )

    def build_revision_writer(self) -> RevisionWriter:
        return RevisionWriter(
            usage=resources.storage_usage_service, quota=resources.storage_quota_service
        )

    def build_input_asset_lifecycle(self) -> ScoreInputAssetLifecycle:
        return ScoreInputAssetLifecycle(
            usage=resources.storage_usage_service, quota=resources.storage_quota_service
        )

    def build_revision_service(self) -> RevisionService:
        return RevisionService(
            post_commit=self.post_commit,
            writes=self.build_object_write_coordinator(),
            quota=resources.storage_quota_service,
            revision_writer=self.build_revision_writer(),
        )

    def build_render_service(self) -> ScoreRevisionRenderService:
        return ScoreRevisionRenderService(
            work_root=self.config.WORK_ROOT,
            delivery=ScoreRevisionRenderDelivery(
                config=RevisionRenderDeliverySettings.model_validate(self.config.model_dump())
            ),
            writes=self.build_object_write_coordinator(),
            usage=resources.storage_usage_service,
        )

    def build_playback_generation_service(
        self, renderer: FluidSynthAudioRenderer
    ) -> PlaybackGenerationService:
        return PlaybackGenerationService(
            renderer=renderer,
            delivery=PlaybackOutboxService(
                config=PlaybackDeliverySettings.model_validate(self.config.model_dump())
            ),
            writes=self.build_object_write_coordinator(),
            usage=resources.storage_usage_service,
        )

    def build_practice_bundle_service(self) -> PracticeBundleService:
        return PracticeBundleService(
            retention=PracticeBundleRetention(config=self.config),
            writes=self.build_object_write_coordinator(),
        )

    def build_import_review_service(self) -> ImportReviewService:
        return ImportReviewService(
            post_commit=self.post_commit,
            writes=self.build_object_write_coordinator(),
            quota=resources.storage_quota_service,
            usage=resources.storage_usage_service,
            revision_writer=self.build_revision_writer(),
            input_assets=self.build_input_asset_lifecycle(),
        )

    def build_import_job_service(self) -> ImportJobService:
        return ImportJobService(
            delivery=self.build_media_delivery_service(), usage=resources.storage_usage_service
        )

    def build_import_deletion_service(self) -> ImportJobDeletionService:
        return ImportJobDeletionService(usage=resources.storage_usage_service)

    def build_import_maintenance_service(self) -> ImportJobMaintenanceService:
        return ImportJobMaintenanceService(
            usage=resources.storage_usage_service,
            config=ImportDispatchSettings.model_validate(self.config.model_dump()),
        )

    def build_import_pipeline_runner(self, config: ImportExecutionConfig) -> ImportPipelineRunner:
        return ImportPipelineRunner(
            config=config,
            writes=self.build_object_write_coordinator(),
            recorder=ImportExecutionRecorder(usage=resources.storage_usage_service),
            sessions=self.sessions,
        )

    def build_score_deletion_executor(self) -> ScoreDeletionExecutor:
        return ScoreDeletionExecutor(
            ScoreDeletionDeliveryService(
                config=ScoreDeletionDeliverySettings.model_validate(self.config.model_dump())
            ),
            usage=resources.storage_usage_service,
            input_assets=self.build_input_asset_lifecycle(),
        )

    def build_derived_asset_retention_service(self) -> DerivedAssetRetentionService:
        return DerivedAssetRetentionService(usage=resources.storage_usage_service)

    def build_take_service(self) -> PerformanceTakeService:
        return PerformanceTakeService(
            delivery=self.build_media_delivery_service(), usage=resources.storage_usage_service
        )

    def build_take_reservation_service(self) -> PerformanceTakeReservationService:
        return PerformanceTakeReservationService(
            uploads=self.build_upload_session_service(),
            delivery=self.build_media_delivery_service(),
            storage_usage_service=resources.storage_usage_service,
            quota=resources.storage_quota_service,
            practice_bundle_service=self.build_practice_bundle_service(),
        )

    def build_take_finalization_service(self) -> PerformanceTakeFinalizationService:
        return PerformanceTakeFinalizationService(
            uploads=self.build_upload_session_service(),
            delivery=self.build_media_delivery_service(),
            storage_usage_service=resources.storage_usage_service,
            quota=resources.storage_quota_service,
        )

    def build_score_service(self) -> ScoreService:
        return ScoreService(
            delivery=self.build_media_delivery_service(),
            lifecycle_service=self.build_score_lifecycle_service(),
        )

    def build_score_lifecycle_service(self) -> ScoreLifecycleService:
        return ScoreLifecycleService(
            dispatch_after_commit=self.score_dispatch,
            deletion_executor=self.build_score_deletion_executor(),
            config=ScoreDeletionDeliverySettings.model_validate(self.config.model_dump()),
        )

    def build_score_asset_service(self) -> ScoreAssetService:
        return ScoreAssetService(delivery=self.build_media_delivery_service())

    def build_playback_delivery_service(self) -> PlaybackDeliveryService:
        return PlaybackDeliveryService(delivery=self.build_media_delivery_service())

    def build_guest_preview_service(self) -> GuestPreviewService:
        return GuestPreviewService(delivery=self.build_media_delivery_service())

    def build_model_asset_service(self) -> ModelAssetService:
        return ModelAssetService(
            delivery=self.build_media_delivery_service(),
            config=ModelAssetDeliverySettings.model_validate(self.config.model_dump()),
        )

    def build_import_artifact_recorder(self) -> ImportArtifactRecorder:
        return ImportArtifactRecorder(
            self.build_object_write_coordinator(),
            self.sessions,
            ImportExecutionRecorder(usage=resources.storage_usage_service),
        )

    def build_take_processing_service(self):
        from app.modules.performance_takes.processing import TakeMediaProcessing
        from app.modules.media_storage.verification import ObjectIntegrityVerifier
        from app.modules.durable_work.delivery import DeliveryLifecyclePolicy

        return TakeMediaProcessing(
            self.sessions,
            ObjectIntegrityVerifier(self.storage),
            DeliveryLifecyclePolicy(
                self.config.TAKE_PROCESSING_MAX_ATTEMPTS,
                self.config.TAKE_PROCESSING_RETRY_SECONDS,
                300,
                self.config.TAKE_PROCESSING_LEASE_SECONDS,
            ),
        )

    def build_take_reservation_cleanup_service(self):
        from app.modules.performance_takes.upload_reservation.cleanup import (
            UploadReservationCleanupService,
        )

        return UploadReservationCleanupService(
            self.build_upload_session_service(),
            resources.storage_quota_service,
            resources.storage_usage_service,
        )
