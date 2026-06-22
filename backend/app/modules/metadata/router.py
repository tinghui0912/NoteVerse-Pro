from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.metadata.dependencies import get_metadata_service
from app.modules.metadata.service import MetadataProjectionService
from app.shared.responses import success_response

router = APIRouter()


@router.get("/{score_id}/revisions/{revision_id}/metadata")
async def get_revision_metadata(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: MetadataProjectionService = Depends(get_metadata_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.get(db, score_id, revision_id, user_id)
    return success_response(data=result.model_dump())


@router.post("/{score_id}/revisions/{revision_id}/metadata/rebuild")
async def rebuild_revision_metadata(
    score_id: str,
    revision_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: MetadataProjectionService = Depends(get_metadata_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.rebuild(db, score_id, revision_id, user_id)
    return success_response(data=result.model_dump())
