from fastapi import APIRouter

from app.modules.auth.router import router as auth
from app.modules.artifacts.router import router as artifacts
from app.modules.artifacts.router import score_artifact_router
from app.modules.files.router import router as files
from app.modules.jobs.router import router as jobs
from app.modules.library.router import router as library
from app.modules.metadata.router import router as metadata
from app.modules.my_scores.router import router as my_scores
from app.modules.practice.router import router as practice
from app.modules.publications.router import public_router as publications
from app.modules.publications.router import score_router as score_publications
from app.modules.profile.router import router as profile
from app.modules.scores.router import router as scores
from app.modules.score_sharing.router import bookmark_router as score_bookmarks
from app.modules.score_sharing.router import grant_router as score_grants
from app.modules.score_sharing.router import score_router as score_sharing

api_router = APIRouter()

api_router.include_router(auth, prefix="/auth", tags=["Authentication"])
api_router.include_router(artifacts, prefix="/artifacts", tags=["Score Artifacts"])
api_router.include_router(files, prefix="/files", tags=["File Operations"])
api_router.include_router(jobs, prefix="/jobs", tags=["Processing Jobs"])
api_router.include_router(library, prefix="/library", tags=["Library"])
api_router.include_router(my_scores, prefix="/my-scores", tags=["My Scores"])
api_router.include_router(scores, prefix="/scores", tags=["Scores"])
api_router.include_router(score_sharing, prefix="/scores", tags=["Score Sharing"])
api_router.include_router(score_grants, prefix="/score-grants", tags=["Score Sharing"])
api_router.include_router(score_bookmarks, prefix="/score-bookmarks", tags=["Score Bookmarks"])
api_router.include_router(score_publications, prefix="/scores", tags=["Publications"])
api_router.include_router(publications, prefix="/publications", tags=["Publications"])
api_router.include_router(score_artifact_router, prefix="/scores", tags=["Score Artifacts"])
api_router.include_router(metadata, prefix="/scores", tags=["Score Metadata"])
api_router.include_router(profile, prefix="/profile", tags=["User Profile"])
api_router.include_router(practice, prefix="/practice", tags=["Practice"])
