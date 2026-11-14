from fastapi import Response, APIRouter, Depends, File, UploadFile

from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.models import User
from app.modules.files.dependencies import get_files_service
from app.modules.files.schemas import UploadFileRead
from app.modules.files.service import FilesService


router = APIRouter()


@router.post("/upload", operation_id="filesUpload", response_model=UploadFileRead)
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    files_service: FilesService = Depends(get_files_service),
):
    result = await files_service.upload_file(db, current_user, file)
    return result


@router.delete(
    "/{filename}",
    operation_id="fileDelete",
    status_code=204,
    response_model=None,
    response_class=Response,
)
async def delete_file(
    filename: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    files_service: FilesService = Depends(get_files_service),
):
    await files_service.delete_uploaded_file(db, current_user, filename)
    return Response(status_code=204)


__all__ = ["router"]
