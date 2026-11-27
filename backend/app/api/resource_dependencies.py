"""HTTP resource wiring; services receive no request-owned write transaction."""

from functools import lru_cache
from app.composition import media_resources as resources
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


def get_avatar_service() -> resources.AvatarService:
    return resources.build_avatar_service()


def get_upload_service() -> resources.UploadService:
    return resources.build_upload_service()


def get_revision_service() -> resources.RevisionService:
    return resources.build_revision_service()


def get_score_service() -> resources.ScoreService:
    return resources.build_score_service()


def get_score_asset_service() -> resources.ScoreAssetService:
    return resources.build_score_asset_service()


def get_playback_delivery_service() -> resources.PlaybackDeliveryService:
    return resources.build_playback_delivery_service()


def get_guest_preview_service() -> resources.GuestPreviewService:
    return resources.build_guest_preview_service()


def get_import_job_service() -> resources.ImportJobService:
    return resources.build_import_job_service()


def get_import_review_service() -> resources.ImportReviewService:
    return resources.build_import_review_service()


def get_practice_bundle_service() -> resources.PracticeBundleService:
    return resources.build_practice_bundle_service()


def get_performance_take_service() -> resources.PerformanceTakeService:
    return resources.build_take_service()


def get_performance_take_reservation_service() -> resources.PerformanceTakeReservationService:
    return resources.build_take_reservation_service()


def get_performance_take_finalization_service() -> resources.PerformanceTakeFinalizationService:
    return resources.build_take_finalization_service()


def get_email_verification_service() -> resources.EmailVerificationService:
    return resources.build_email_verification_service()


@lru_cache(maxsize=1)
def get_model_asset_service() -> resources.ModelAssetService:
    return resources.build_model_asset_service()


def get_storage_usage_reader() -> Callable[[Session, int], StorageUsageRead]:
    return read_storage_usage


def get_upload_session_service():
    from app.composition.storage_resources import build_upload_session_service
    from app.storage import object_storage

    return build_upload_session_service(object_storage)
