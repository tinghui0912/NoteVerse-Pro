"""Explicit resource-service construction shared by independent HTTP and worker roots."""

from app.storage import ObjectStorage, object_storage
from app.composition import storage_resources as resources
from app.modules.account.avatar_service import AvatarService
from app.modules.auth.email_verification_service import EmailVerificationService
from app.modules.uploads.service import UploadService
from app.modules.revisions.service import RevisionService
from app.modules.revisions.writer import RevisionWriter
from app.modules.revisions.derived_asset_retention_service import DerivedAssetRetentionService
from app.modules.scores.input_asset_lifecycle import ScoreInputAssetLifecycle
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


def build_avatar_service(storage: ObjectStorage = object_storage) -> AvatarService:
    return AvatarService(
        writes=resources.build_object_write_coordinator(storage),
        delivery=resources.build_media_delivery_service(storage),
    )


def build_upload_service(storage: ObjectStorage = object_storage) -> UploadService:
    return UploadService(
        writes=resources.build_object_write_coordinator(storage),
        usage=resources.storage_usage_service,
        quota=resources.storage_quota_service,
    )


def build_revision_writer() -> RevisionWriter:
    return RevisionWriter(
        usage=resources.storage_usage_service, quota=resources.storage_quota_service
    )


def build_input_asset_lifecycle() -> ScoreInputAssetLifecycle:
    return ScoreInputAssetLifecycle(
        usage=resources.storage_usage_service, quota=resources.storage_quota_service
    )


def build_revision_service(storage: ObjectStorage = object_storage) -> RevisionService:
    return RevisionService(
        writes=resources.build_object_write_coordinator(storage),
        quota=resources.storage_quota_service,
        revision_writer=build_revision_writer(),
    )


def build_render_service(storage: ObjectStorage = object_storage) -> ScoreRevisionRenderService:
    return ScoreRevisionRenderService(
        writes=resources.build_object_write_coordinator(storage),
        usage=resources.storage_usage_service,
    )


def build_playback_generation_service(
    storage: ObjectStorage = object_storage,
) -> PlaybackGenerationService:
    return PlaybackGenerationService(
        writes=resources.build_object_write_coordinator(storage),
        usage=resources.storage_usage_service,
    )


def build_practice_bundle_service(storage: ObjectStorage = object_storage) -> PracticeBundleService:
    return PracticeBundleService(writes=resources.build_object_write_coordinator(storage))


def build_import_review_service(storage: ObjectStorage = object_storage) -> ImportReviewService:
    return ImportReviewService(
        writes=resources.build_object_write_coordinator(storage),
        quota=resources.storage_quota_service,
        usage=resources.storage_usage_service,
        revision_writer=build_revision_writer(),
        input_assets=build_input_asset_lifecycle(),
    )


def build_import_job_service(storage: ObjectStorage = object_storage) -> ImportJobService:
    return ImportJobService(
        delivery=resources.build_media_delivery_service(storage),
        usage=resources.storage_usage_service,
    )


def build_import_deletion_service() -> ImportJobDeletionService:
    return ImportJobDeletionService(usage=resources.storage_usage_service)


def build_import_maintenance_service() -> ImportJobMaintenanceService:
    return ImportJobMaintenanceService(usage=resources.storage_usage_service)


def build_import_pipeline_runner(storage: ObjectStorage = object_storage) -> ImportPipelineRunner:
    return ImportPipelineRunner(
        writes=resources.build_object_write_coordinator(storage),
        recorder=ImportExecutionRecorder(usage=resources.storage_usage_service),
        sessions=resources.write_sessions,
    )


def build_score_deletion_executor() -> ScoreDeletionExecutor:
    return ScoreDeletionExecutor(
        usage=resources.storage_usage_service, input_assets=build_input_asset_lifecycle()
    )


def build_derived_asset_retention_service() -> DerivedAssetRetentionService:
    return DerivedAssetRetentionService(usage=resources.storage_usage_service)


def build_take_service(storage: ObjectStorage = object_storage) -> PerformanceTakeService:
    return PerformanceTakeService(
        delivery=resources.build_media_delivery_service(storage),
        usage=resources.storage_usage_service,
    )


def build_take_reservation_service(
    storage: ObjectStorage = object_storage,
) -> PerformanceTakeReservationService:
    return PerformanceTakeReservationService(
        storage=storage,
        delivery=resources.build_media_delivery_service(storage),
        storage_usage_service=resources.storage_usage_service,
        quota=resources.storage_quota_service,
        practice_bundle_service=build_practice_bundle_service(storage),
    )


def build_take_finalization_service(
    storage: ObjectStorage = object_storage,
) -> PerformanceTakeFinalizationService:
    return PerformanceTakeFinalizationService(
        storage=storage,
        delivery=resources.build_media_delivery_service(storage),
        storage_usage_service=resources.storage_usage_service,
        quota=resources.storage_quota_service,
    )


def build_score_service(storage: ObjectStorage = object_storage) -> ScoreService:
    return ScoreService(
        delivery=resources.build_media_delivery_service(storage),
        lifecycle_service=build_score_lifecycle_service(),
    )


def build_score_lifecycle_service() -> ScoreLifecycleService:
    return ScoreLifecycleService(deletion_executor=build_score_deletion_executor())


def build_score_asset_service(storage: ObjectStorage = object_storage) -> ScoreAssetService:
    return ScoreAssetService(delivery=resources.build_media_delivery_service(storage))


def build_playback_delivery_service(
    storage: ObjectStorage = object_storage,
) -> PlaybackDeliveryService:
    return PlaybackDeliveryService(delivery=resources.build_media_delivery_service(storage))


def build_guest_preview_service(storage: ObjectStorage = object_storage) -> GuestPreviewService:
    return GuestPreviewService(delivery=resources.build_media_delivery_service(storage))


def build_model_asset_service(storage: ObjectStorage = object_storage) -> ModelAssetService:
    return ModelAssetService(delivery=resources.build_media_delivery_service(storage))


def build_email_verification_service() -> EmailVerificationService:
    return EmailVerificationService(resources.provision_storage_resources)


def build_import_artifact_recorder(
    storage: ObjectStorage = object_storage,
) -> ImportArtifactRecorder:
    return ImportArtifactRecorder(
        resources.build_object_write_coordinator(storage),
        resources.write_sessions,
        ImportExecutionRecorder(usage=resources.storage_usage_service),
    )
