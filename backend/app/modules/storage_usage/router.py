from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.storage_usage.dependencies import get_storage_usage_service
from app.modules.storage_usage.schemas import StorageUsageRead
from app.modules.storage_usage.service import StorageUsageService
from app.shared.responses import APIResponse, success_response

router = APIRouter()


@router.get("/storage-usage", response_model=APIResponse[StorageUsageRead])
async def get_storage_usage(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: StorageUsageService = Depends(get_storage_usage_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    return success_response(data=await service.get_usage(db, user_id))
