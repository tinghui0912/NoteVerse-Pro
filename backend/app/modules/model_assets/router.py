"""Routes for platform model asset delivery access."""

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.db.models.user import User
from app.modules.model_assets.schemas import ModelAssetAccessRead
from app.modules.model_assets.service import ModelAssetService, get_model_asset_service
from app.shared.responses import APIResponse, success_response

router = APIRouter()


@router.get(
    "/bytedance-note/access",
    response_model=APIResponse[ModelAssetAccessRead],
    summary="Get short-lived presigned access for ByteDance note model",
)
async def get_bytedance_note_model_access(
    current_user: User = Depends(get_current_user),
    service: ModelAssetService = Depends(get_model_asset_service),
) -> APIResponse[ModelAssetAccessRead]:
    """Return model asset descriptor with short-lived presigned download URL for authenticated users."""
    access = service.get_bytedance_note_model_access()
    return success_response(data=access)
