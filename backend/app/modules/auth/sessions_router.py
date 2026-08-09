"""Routes for authenticated session management."""

from fastapi import APIRouter, Cookie, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api import deps
from app.core.config import settings
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.auth.dependencies import get_session_service
from app.modules.auth.session_cookies import clear_session_cookies
from app.modules.auth.schemas import SessionsRead
from app.modules.auth.sessions_service import SessionService
from app.shared.constants import SuccessCode
from app.shared.responses import APIResponse, EmptyResponse, success_response

router = APIRouter()
SESSION_LIST_DEFAULT_LIMIT = 100
SESSION_LIST_MAX_LIMIT = 100


@router.get("/sessions", response_model=APIResponse[SessionsRead])
async def list_my_sessions(
    limit: int = Query(default=SESSION_LIST_DEFAULT_LIMIT, ge=1, le=SESSION_LIST_MAX_LIMIT),
    current_user: User = Depends(deps.get_current_user),
    db: AsyncSession = Depends(deps.get_db),
    refresh_cookie: str | None = Cookie(default=None, alias=settings.REFRESH_COOKIE_NAME),
    session_service: SessionService = Depends(get_session_service),
) -> APIResponse[SessionsRead]:
    user_id = require_persisted_id(current_user.id, entity="user")
    sessions = await session_service.list_user_sessions(
        db,
        user_id,
        current_refresh_token=refresh_cookie,
        limit=limit,
    )
    return success_response(data=SessionsRead(sessions=sessions))


@router.delete("/sessions/{session_id}", response_model=EmptyResponse)
async def revoke_my_session(
    session_id: int,
    response: Response,
    current_user: User = Depends(deps.get_current_user),
    db: AsyncSession = Depends(deps.get_db),
    refresh_cookie: str | None = Cookie(default=None, alias=settings.REFRESH_COOKIE_NAME),
    session_service: SessionService = Depends(get_session_service),
) -> EmptyResponse:
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


@router.delete("/sessions", response_model=EmptyResponse)
async def revoke_my_other_sessions(
    current_user: User = Depends(deps.get_current_user),
    db: AsyncSession = Depends(deps.get_db),
    refresh_cookie: str | None = Cookie(default=None, alias=settings.REFRESH_COOKIE_NAME),
    session_service: SessionService = Depends(get_session_service),
) -> EmptyResponse:
    user_id = require_persisted_id(current_user.id, entity="user")
    await session_service.revoke_other_user_sessions(
        db,
        user_id,
        current_refresh_token=refresh_cookie,
    )
    return success_response(message=SuccessCode.SESSIONS_REVOKED)
