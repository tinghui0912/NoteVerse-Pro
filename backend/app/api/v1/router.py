from fastapi import APIRouter

from app.modules.auth.router import router as auth
from app.modules.files.router import router as files
from app.modules.practice.router import router as practice
from app.modules.profile.router import router as profile
from app.modules.shares.router import router as shares
from app.modules.tasks.router import router as tasks
from app.modules.xml.router import router as xml

api_router = APIRouter()

api_router.include_router(auth, prefix="/auth", tags=["Authentication"])
api_router.include_router(files, prefix="/files", tags=["File Operations"])
api_router.include_router(tasks, prefix="/tasks", tags=["Task Management"])
api_router.include_router(xml, prefix="/xml", tags=["XML Editor"])
api_router.include_router(shares, prefix="/shares", tags=["Sharing"])
api_router.include_router(profile, prefix="/profile", tags=["User Profile"])
api_router.include_router(practice, prefix="/practice", tags=["Practice"])
