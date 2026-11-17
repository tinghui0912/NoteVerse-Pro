from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from .schemas import PracticeActivityCreateRequest, PracticeActivityRead
from .service import PracticeActivityService

router = APIRouter()


@router.post("", operation_id="practiceActivityCreate", response_model=PracticeActivityRead)
def create_activity(
    request: PracticeActivityCreateRequest,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
) -> PracticeActivityRead:
    return PracticeActivityService().create(
        db, require_persisted_id(user.id, entity="user"), request
    )
