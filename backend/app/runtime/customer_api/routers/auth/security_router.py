"""Routes for authenticated account security overview."""

from app.platform.db.dependencies import get_db

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.runtime.customer_api import deps
from app.db.models import User
from app.runtime.customer_api.auth_services import get_security_service
from app.modules.auth.schemas import SecurityRead
from app.modules.auth.security_service import SecurityService


router = APIRouter()


@router.get("/security", operation_id="accountSecurityGet", response_model=SecurityRead)
def get_my_security_overview(
    current_user: User = Depends(deps.get_current_user),
    db: Session = Depends(get_db),
    security_service: SecurityService = Depends(get_security_service),
) -> SecurityRead:
    return SecurityRead(security=security_service.overview(db, current_user))
