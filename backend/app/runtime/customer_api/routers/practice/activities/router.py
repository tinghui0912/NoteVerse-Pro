from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.platform.db.dependencies import get_command_db
from app.runtime.customer_api.deps import get_current_user
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.practice.activities.schemas import (
    PracticeActivityCreateRequest,
    PracticeActivityRead,
)
from app.modules.practice.activities.service import PracticeActivityService

router = APIRouter()


@router.post("", operation_id="practiceActivityCreate", response_model=PracticeActivityRead)
def create_activity(
    request: PracticeActivityCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_command_db, scope="function"),
) -> PracticeActivityRead:
    return PracticeActivityService().create(
        db, require_persisted_id(user.id, entity="user"), request
    )
