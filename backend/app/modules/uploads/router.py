from fastapi import Response, APIRouter, Depends, File, UploadFile

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.models import User
from app.modules.uploads.dependencies import get_upload_service
from app.modules.uploads.schemas import UploadRead
from app.modules.uploads.service import UploadService


router = APIRouter()


@router.post("", operation_id="uploadsCreate", response_model=UploadRead)
async def create_upload(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    upload_service: UploadService = Depends(get_upload_service),
):
    result = await upload_service.create_upload(db, current_user, file)
    return result


@router.delete(
    "/{upload_id}",
    operation_id="uploadDelete",
    status_code=204,
    response_model=None,
    response_class=Response,
)
async def delete_upload(
    upload_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    upload_service: UploadService = Depends(get_upload_service),
):
    await upload_service.delete_upload(db, current_user, upload_id)
    return Response(status_code=204)


__all__ = ["router"]
