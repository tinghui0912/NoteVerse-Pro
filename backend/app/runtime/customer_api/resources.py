"""HTTP resource wiring; services receive no request-owned write transaction."""

from fastapi import Request
from app.modules.auth.email_verification_service import EmailVerificationService
from app.platform.config.application import AccountEmailConfig
from app.composition.storage_resources import provision_storage_resources
from app.modules.fingering.service import FingeringService
from app.processing.engines.fingering import PianoplayerFingeringEngine
from app.platform.config.fingering_execution import FingeringExecutionSettings
from app.modules.account.avatar_service import AvatarService
from app.modules.guest_previews.service import GuestPreviewService
from app.modules.import_jobs.service import ImportJobService
from app.modules.import_jobs.review.service import ImportReviewService
from app.modules.model_assets.service import ModelAssetService
from app.modules.performance_takes.finalization import PerformanceTakeFinalizationService
from app.modules.performance_takes.upload_reservation.reservation_service import (
    PerformanceTakeReservationService,
)
from app.modules.performance_takes.service import PerformanceTakeService
from app.modules.playback.delivery import PlaybackDeliveryService
from app.modules.practice.bundle.service import PracticeBundleService
from app.modules.revisions.service import RevisionService
from app.modules.score_assets.service import ScoreAssetService
from app.modules.scores.service import ScoreService
from app.modules.uploads.service import UploadService
from app.modules.media_storage.upload_sessions.service import UploadSessionService
from app.composition.storage_resources import storage_usage_service, storage_quota_service
from app.modules.storage_governance.usage.service import StorageUsageService
from app.modules.storage_governance.quota.service import StorageQuotaService

from collections.abc import Callable
from sqlalchemy.orm import Session
from app.modules.storage_governance.quota.schemas import StorageUsageRead
from app.composition.storage_resources import read_storage_usage


def get_storage_usage_service() -> StorageUsageService:
    return storage_usage_service


def get_storage_quota_service() -> StorageQuotaService:
    return storage_quota_service


def get_avatar_service(request: Request) -> AvatarService:
    return request.app.state.resources.build_avatar_service()


def get_upload_service(request: Request) -> UploadService:
    return request.app.state.resources.build_upload_service()


def get_revision_service(request: Request) -> RevisionService:
    return request.app.state.resources.build_revision_service()


def get_score_service(request: Request) -> ScoreService:
    return request.app.state.resources.build_score_service()


def get_score_asset_service(request: Request) -> ScoreAssetService:
    return request.app.state.resources.build_score_asset_service()


def get_playback_delivery_service(request: Request) -> PlaybackDeliveryService:
    return request.app.state.resources.build_playback_delivery_service()


def get_guest_preview_service(request: Request) -> GuestPreviewService:
    return request.app.state.resources.build_guest_preview_service()


def get_import_job_service(request: Request) -> ImportJobService:
    return request.app.state.resources.build_import_job_service()


def get_import_review_service(request: Request) -> ImportReviewService:
    return request.app.state.resources.build_import_review_service()


def get_practice_bundle_service(request: Request) -> PracticeBundleService:
    return request.app.state.resources.build_practice_bundle_service()


def get_performance_take_service(request: Request) -> PerformanceTakeService:
    return request.app.state.resources.build_take_service()


def get_performance_take_reservation_service(
    request: Request,
) -> PerformanceTakeReservationService:
    return request.app.state.resources.build_take_reservation_service()


def get_performance_take_finalization_service(
    request: Request,
) -> PerformanceTakeFinalizationService:
    return request.app.state.resources.build_take_finalization_service()


def get_email_verification_service(request: Request) -> EmailVerificationService:
    return EmailVerificationService(
        provision_storage_resources,
        config=AccountEmailConfig.model_validate(request.app.state.settings.model_dump()),
    )


def get_model_asset_service(request: Request) -> ModelAssetService:
    return request.app.state.resources.build_model_asset_service()


def get_storage_usage_reader() -> Callable[[Session, int], StorageUsageRead]:
    return read_storage_usage


def get_upload_session_service(request: Request) -> UploadSessionService:
    return request.app.state.resources.build_upload_session_service()


def get_fingering_service(request: Request) -> FingeringService:
    config = request.app.state.settings
    return FingeringService(
        engine=PianoplayerFingeringEngine(work_root=config.WORK_ROOT),
        execution=request.app.state.fingering_execution,
        config=FingeringExecutionSettings.model_validate(config.model_dump()),
    )
