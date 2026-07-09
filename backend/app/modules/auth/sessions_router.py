"""Routes for authenticated session management."""

from fastapi import APIRouter, Cookie, Depends, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.config import settings
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.auth.dependencies import get_session_service
from app.modules.auth.session_cookies import clear_session_cookies
from app.modules.auth.sessions_service import SessionService
from app.shared.constants import SuccessCode
from app.shared.responses import SuccessResponsePayload, success_response

router = APIRouter()


@router.get("/sessions")
async def list_my_sessions(
    current_user: User = Depends(deps.get_current_user),
    db: AsyncSession = Depends(deps.get_db),
    refresh_cookie: str | None = Cookie(default=None, alias=settings.REFRESH_COOKIE_NAME),
    session_service: SessionService = Depends(get_session_service),
) -> SuccessResponsePayload:
    user_id = require_persisted_id(current_user.id, entity="user")
    sessions = await session_service.list_user_sessions(
        db,
        user_id,
        current_refresh_token=refresh_cookie,
    )
    return success_response(data={"sessions": sessions})


@router.delete("/sessions/{session_id}")
async def revoke_my_session(
    session_id: int,
    response: Response,
    current_user: User = Depends(deps.get_current_user),
    db: AsyncSession = Depends(deps.get_db),
    refresh_cookie: str | None = Cookie(default=None, alias=settings.REFRESH_COOKIE_NAME),
    session_service: SessionService = Depends(get_session_service),
) -> SuccessResponsePayload:
    user_id = require_persisted_id(current_user.id, entity="user")
    revoked_current = await session_service.revoke_user_session(
        db,
        user_id,
        session_id,
        current_refresh_token=refresh_cookie,
    )
    if revoked_current:
        clear_session_cookies(response)
    return success_response(message=SuccessCode.SESSION_REVOKED)


@router.delete("/sessions")
async def revoke_my_other_sessions(
    current_user: User = Depends(deps.get_current_user),
    db: AsyncSession = Depends(deps.get_db),
    refresh_cookie: str | None = Cookie(default=None, alias=settings.REFRESH_COOKIE_NAME),
    session_service: SessionService = Depends(get_session_service),
) -> SuccessResponsePayload:
    user_id = require_persisted_id(current_user.id, entity="user")
    await session_service.revoke_other_user_sessions(
        db,
        user_id,
        current_refresh_token=refresh_cookie,
    )
    return success_response(message=SuccessCode.SESSIONS_REVOKED)
