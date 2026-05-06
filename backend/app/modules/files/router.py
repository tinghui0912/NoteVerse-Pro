"""
Canonical router for the files module.
"""
from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import FileResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.models import Task, User
from app.modules.files.dependencies import get_file_task_with_view_access, get_files_service
from app.modules.files.schemas import ExportTasksExcelRequest
from app.modules.files.service import FilesService
from app.shared.constants import SuccessCode
from app.shared.responses import success_response

router = APIRouter()


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    files_service: FilesService = Depends(get_files_service),
):
    result = await files_service.upload_file(db, current_user, file)
    return success_response(data=result, message=SuccessCode.FILE_UPLOADED)


@router.get("/download/{file_type}/{task_id}")
async def download_file(
    file_type: str,
    task_id: str,
    page: int = Query(1, ge=1, description="Page number starting from 1"),
    share_token: str | None = Query(default=None, description="Optional share token for access"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    files_service: FilesService = Depends(get_files_service),
):
    file_path, filename, media_type = await files_service.download_task_file(
        db=db,
        current_user=current_user,
        task_id=task_id,
        file_type=file_type,
        page=page,
        share_token=share_token,
    )
    return FileResponse(
        path=file_path,
        filename=filename,
        media_type=media_type,
    )


@router.get("/tasks/{task_id}")
async def get_task_files(
    task: Task = Depends(get_file_task_with_view_access),
    db: AsyncSession = Depends(get_db),
    files_service: FilesService = Depends(get_files_service),
):
    result = await files_service.list_task_files(db, task)
    return success_response(data=result)


@router.get("/preview/{filename}")
async def preview_file(
    filename: str,
    current_user: User = Depends(get_current_user),
    files_service: FilesService = Depends(get_files_service),
):
    file_path, preview_filename, mime_type = files_service.preview_file(filename)
    return FileResponse(
        path=file_path,
        media_type=mime_type or "application/octet-stream",
        filename=preview_filename,
    )


@router.delete("/{filename}")
async def delete_file(
    filename: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    files_service: FilesService = Depends(get_files_service),
):
    result = await files_service.delete_uploaded_file(db, current_user, filename)
    return success_response(data=result, message=SuccessCode.FILE_DELETED)


@router.post("/export/excel")
async def export_tasks_excel(
    request: ExportTasksExcelRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    files_service: FilesService = Depends(get_files_service),
):
    excel_file, filename = await files_service.export_tasks_excel(db, current_user, request)
    return StreamingResponse(
        excel_file,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename={filename}"},
    )


__all__ = ["router"]
