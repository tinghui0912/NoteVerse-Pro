from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models.user import User
from app.composition.storage_resources import read_storage_usage
from app.modules.storage_quota.schemas import StorageUsageRead


router = APIRouter()


@router.get(
    "/storage-usage",
    operation_id="accountStorageUsageGet",
    response_model=StorageUsageRead,
)
def get_storage_usage(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    return read_storage_usage(db, user_id)
