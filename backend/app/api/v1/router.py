from fastapi import APIRouter

from app.modules.account.router import router as account
from app.modules.auth.router import router as auth
from app.modules.auth.email_change_router import auth_router as auth_email_change
from app.modules.auth.email_change_router import me_router as account_email_change
from app.modules.auth.password_router import router as auth_password
from app.modules.auth.security_router import router as auth_security
from app.modules.auth.sessions_router import router as auth_sessions
from app.modules.files.router import router as files
from app.modules.import_jobs.router import router as jobs
from app.modules.library.router import router as library
from app.modules.my_scores.router import router as my_scores
from app.modules.notifications.router import router as notifications
from app.modules.ops.router import router as ops
from app.modules.playback.router import router as playback
from app.modules.practice.router import router as practice
from app.modules.realtime.router import router as realtime
from app.modules.publications.router import public_router as publications
from app.modules.publications.router import score_router as score_publications
from app.modules.review.router import router as review
from app.modules.scores.router import router as scores
from app.modules.storage_usage.router import router as storage_usage
from app.modules.score_assets.router import render_asset_router
from app.modules.score_assets.router import score_router as score_assets
from app.modules.score_assets.router import source_router as revision_sources
from app.modules.score_sharing.router import grant_router as score_grants
from app.modules.score_sharing.router import score_router as score_sharing
from app.modules.score_invites.router import invite_router as score_invite_entries
from app.modules.score_invites.router import me_router as score_invite_me
from app.modules.score_invites.router import score_router as score_invites

api_router = APIRouter()

api_router.include_router(account, prefix="/me", tags=["Account"])
api_router.include_router(auth, prefix="/auth", tags=["Authentication"])
api_router.include_router(auth_email_change, prefix="/auth", tags=["Authentication"])
api_router.include_router(account_email_change, prefix="/me", tags=["Account Security"])
api_router.include_router(auth_password, prefix="/me", tags=["Account Security"])
api_router.include_router(auth_security, prefix="/me", tags=["Account Security"])
api_router.include_router(auth_sessions, prefix="/me", tags=["Account Security"])
api_router.include_router(revision_sources, prefix="/revision-sources", tags=["Score Revision Sources"])
api_router.include_router(render_asset_router, prefix="/render-assets", tags=["Score Render Assets"])
api_router.include_router(files, prefix="/files", tags=["File Operations"])
api_router.include_router(jobs, prefix="/import-jobs", tags=["Import Jobs"])
api_router.include_router(library, prefix="/library", tags=["Library"])
api_router.include_router(my_scores, prefix="/my-scores", tags=["My Scores"])
api_router.include_router(scores, prefix="/scores", tags=["Scores"])
api_router.include_router(score_assets, prefix="/scores", tags=["Score Assets"])
api_router.include_router(score_sharing, prefix="/scores", tags=["Score Sharing"])
api_router.include_router(score_invites, prefix="/scores", tags=["Score Collaboration"])
api_router.include_router(score_grants, prefix="/score-grants", tags=["Score Sharing"])
api_router.include_router(score_invite_entries, prefix="/invites", tags=["Score Collaboration"])
api_router.include_router(score_invite_me, prefix="/me", tags=["Score Collaboration"])
api_router.include_router(notifications, prefix="/me", tags=["Notifications"])
api_router.include_router(storage_usage, prefix="/me", tags=["Storage Usage"])
api_router.include_router(score_publications, prefix="/scores", tags=["Publications"])
api_router.include_router(publications, prefix="/publications", tags=["Publications"])
api_router.include_router(playback, tags=["Playback"])
api_router.include_router(practice, prefix="/practice", tags=["Practice"])
api_router.include_router(realtime, prefix="/realtime", tags=["Realtime"])
api_router.include_router(review, prefix="/review", tags=["Review"])
api_router.include_router(ops, prefix="/ops", tags=["Operations"])
