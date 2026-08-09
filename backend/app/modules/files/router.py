from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.models import User
from app.modules.files.dependencies import get_files_service
from app.modules.files.schemas import DeleteUploadedFileRead, UploadFileRead
from app.modules.files.service import FilesService
from app.shared.constants import SuccessCode
from app.shared.responses import APIResponse, success_response

router = APIRouter()


@router.post("/upload", response_model=APIResponse[UploadFileRead])
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    files_service: FilesService = Depends(get_files_service),
):
    result = await files_service.upload_file(db, current_user, file)
    return success_response(data=result, message=SuccessCode.FILE_UPLOADED)


@router.delete("/{filename}", response_model=APIResponse[DeleteUploadedFileRead])
async def delete_file(
    filename: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    files_service: FilesService = Depends(get_files_service),
):
    result = await files_service.delete_uploaded_file(db, current_user, filename)
    return success_response(data=result, message=SuccessCode.FILE_DELETED)


__all__ = ["router"]
