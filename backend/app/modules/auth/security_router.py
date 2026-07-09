"""Routes for authenticated account security overview."""

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.db.models import User
from app.modules.auth.dependencies import get_security_service
from app.modules.auth.security_service import SecurityService
from app.shared.responses import SuccessResponsePayload, success_response

router = APIRouter()


@router.get("/security")
async def get_my_security_overview(
    current_user: User = Depends(deps.get_current_user),
    db: AsyncSession = Depends(deps.get_db),
    security_service: SecurityService = Depends(get_security_service),
) -> SuccessResponsePayload:
    return success_response(
        data={"security": await security_service.overview(db, current_user)}
    )
