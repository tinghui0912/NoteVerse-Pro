from app.runtime.customer_api.routers.media_storage.upload_sessions.router import (
    router as upload_sessions_router,
)
from fastapi import APIRouter

from app.runtime.customer_api.routers.account.router import router as account
from app.runtime.customer_api.routers.auth.router import router as auth
from app.runtime.customer_api.routers.auth.email_change_router import (
    auth_router as auth_email_change,
)
from app.runtime.customer_api.routers.auth.email_change_router import (
    me_router as account_email_change,
)
from app.runtime.customer_api.routers.auth.password_router import router as auth_password
from app.runtime.customer_api.routers.auth.security_router import router as auth_security
from app.runtime.customer_api.routers.auth.sessions_router import router as auth_sessions
from app.runtime.customer_api.routers.uploads.router import router as uploads
from app.runtime.customer_api.routers.import_jobs.router import router as jobs
from app.runtime.customer_api.routers.library.router import router as library
from app.runtime.customer_api.routers.notifications.router import router as notifications
from app.runtime.customer_api.routers.playback.router import router as playback
from app.runtime.customer_api.routers.model_assets.router import router as model_assets
from app.runtime.customer_api.routers.realtime.router import router as realtime
from app.runtime.customer_api.routers.import_jobs.review.router import router as review
from app.runtime.customer_api.routers.performance_takes.router import router as performance_takes
from app.runtime.customer_api.routers.practice.bundle.router import router as practice_bundles
from app.runtime.customer_api.routers.practice.activities.router import (
    router as practice_activities,
)
from app.runtime.customer_api.routers.scores.router import router as scores
from app.runtime.customer_api.routers.storage_governance.quota.router import router as storage_usage
from app.runtime.customer_api.routers.score_assets.router import render_asset_router
from app.runtime.customer_api.routers.score_assets.router import score_router as score_assets
from app.runtime.customer_api.routers.score_assets.router import source_router as revision_sources
from app.runtime.customer_api.routers.guest_previews.router import (
    preview_router as guest_preview_entries,
)
from app.runtime.customer_api.routers.guest_previews.router import score_router as guest_previews
from app.runtime.customer_api.routers.collaboration.router import (
    invite_router as score_invite_entries,
)
from app.runtime.customer_api.routers.collaboration.router import me_router as score_invite_me
from app.runtime.customer_api.routers.collaboration.router import score_router as score_invites

from app.shared.responses import ApiErrorResponse

api_router = APIRouter(
    responses={
        "default": {"model": ApiErrorResponse, "description": "Application failure."},
        422: {
            "model": ApiErrorResponse,
            "description": "Request or application validation failure.",
        },
    }
)

api_router.include_router(account, prefix="/me", tags=["Account"])
api_router.include_router(auth, prefix="/auth", tags=["Authentication"])
api_router.include_router(auth_email_change, prefix="/auth", tags=["Authentication"])
api_router.include_router(account_email_change, prefix="/me", tags=["Account Security"])
api_router.include_router(auth_password, prefix="/me", tags=["Account Security"])
api_router.include_router(auth_security, prefix="/me", tags=["Account Security"])
api_router.include_router(auth_sessions, prefix="/me", tags=["Account Security"])
api_router.include_router(
    revision_sources, prefix="/revision-sources", tags=["Score Revision Sources"]
)
api_router.include_router(
    render_asset_router, prefix="/render-assets", tags=["Score Render Assets"]
)
api_router.include_router(uploads, prefix="/uploads", tags=["Uploads"])
api_router.include_router(jobs, prefix="/import-jobs", tags=["Import Jobs"])
api_router.include_router(library, prefix="/library", tags=["Library"])
api_router.include_router(scores, prefix="/scores", tags=["Scores"])
api_router.include_router(score_assets, prefix="/scores", tags=["Score Assets"])
api_router.include_router(guest_previews, prefix="/scores", tags=["Guest Previews"])
api_router.include_router(score_invites, prefix="/scores", tags=["Score Collaboration"])
api_router.include_router(guest_preview_entries, prefix="/guest-previews", tags=["Guest Previews"])
api_router.include_router(score_invite_entries, prefix="/invites", tags=["Score Collaboration"])
api_router.include_router(score_invite_me, prefix="/me", tags=["Score Collaboration"])
api_router.include_router(notifications, prefix="/me", tags=["Notifications"])
api_router.include_router(storage_usage, prefix="/me", tags=["Storage Usage"])
api_router.include_router(playback, tags=["Playback"])
api_router.include_router(model_assets, prefix="/model-assets", tags=["Model Assets"])
api_router.include_router(realtime, prefix="/realtime", tags=["Realtime"])
api_router.include_router(review, prefix="/import-jobs", tags=["Import Review"])
api_router.include_router(
    performance_takes, prefix="/performance-takes", tags=["Performance Takes"]
)
api_router.include_router(practice_bundles, prefix="/practice", tags=["Practice Sources"])

api_router.include_router(
    practice_activities, prefix="/practice-activities", tags=["Practice Activities"]
)

api_router.include_router(
    upload_sessions_router, prefix="/upload-sessions", tags=["upload-sessions"]
)
