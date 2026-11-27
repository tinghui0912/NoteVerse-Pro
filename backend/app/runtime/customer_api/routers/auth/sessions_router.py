"""Routes for authenticated session management."""

from app.platform.db.dependencies import get_db
from fastapi import Request

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from uuid import UUID
from app.runtime.customer_api.deps import session_token
from app.runtime.customer_api import deps
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.runtime.customer_api.auth_services import get_session_service
from app.modules.auth.session_cookies import clear_session_cookies
from app.modules.auth.schemas import SessionsRead
from app.modules.auth.sessions_service import SessionService


router = APIRouter()
SESSION_LIST_DEFAULT_LIMIT = 100
SESSION_LIST_MAX_LIMIT = 100


@router.get("/sessions", operation_id="accountSessionsList", response_model=SessionsRead)
def list_my_sessions(
    http_request: Request,
    limit: int = Query(default=SESSION_LIST_DEFAULT_LIMIT, ge=1, le=SESSION_LIST_MAX_LIMIT),
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(get_db),
    session_service: SessionService = Depends(get_session_service),
) -> SessionsRead:
    user_id = require_persisted_id(current_user.id, entity="user")
    sessions = session_service.list_user_sessions(
        db,
        user_id,
        current_token=session_token(http_request),
        limit=limit,
    )
    return SessionsRead(sessions=sessions)


@router.delete(
    "/sessions/{session_id}",
    operation_id="accountSessionRevoke",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def revoke_my_session(
    http_request: Request,
    session_id: UUID,
    response: Response,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(get_db),
    session_service: SessionService = Depends(get_session_service),
) -> Response:
    user_id = require_persisted_id(current_user.id, entity="user")
    revoked_current = session_service.revoke_user_session(
        db,
        user_id,
        session_id,
        current_token=session_token(http_request),
    )
    if revoked_current:
        clear_session_cookies(response, config=http_request.app.state.settings)
    response.status_code = 204
    return response


@router.delete(
    "/sessions",
    operation_id="accountOtherSessionsRevoke",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def revoke_my_other_sessions(
    http_request: Request,
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(get_db),
    session_service: SessionService = Depends(get_session_service),
) -> Response:
    user_id = require_persisted_id(current_user.id, entity="user")
    session_service.revoke_other_user_sessions(
        db,
        user_id,
        current_token=session_token(http_request),
    )
    return Response(status_code=204)
