"""Routes for platform model asset delivery access."""

from fastapi import APIRouter, Depends

from app.api.deps import get_current_user
from app.db.models.user import User
from app.modules.model_assets.schemas import PracticeAcousticAccessRead
from app.modules.model_assets.service import ModelAssetService, get_model_asset_service
from app.shared.responses import APIResponse, SuccessResponsePayload, success_response

router = APIRouter()


@router.get("/practice-acoustic/access", response_model=APIResponse[PracticeAcousticAccessRead])
async def get_practice_acoustic_access(
    current_user: User = Depends(get_current_user),
    service: ModelAssetService = Depends(get_model_asset_service),
) -> SuccessResponsePayload:
    """Asset delivery only; no server Practice execution."""
    return success_response(data=service.get_practice_acoustic_access())
