"""Routes for authenticated account security overview."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.db.models import User
from app.modules.auth.dependencies import get_security_service
from app.modules.auth.schemas import SecurityRead
from app.modules.auth.security_service import SecurityService
from app.shared.responses import APIResponse

router = APIRouter()


@router.get("/security", response_model=APIResponse[SecurityRead])
async def get_my_security_overview(
    current_user: User = Depends(deps.get_current_user),
    db: AsyncSession = Depends(deps.get_db),
    security_service: SecurityService = Depends(get_security_service),
) -> APIResponse[SecurityRead]:
    return APIResponse(
        success=True,
        data=SecurityRead(security=await security_service.overview(db, current_user)),
    )
