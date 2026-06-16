"""
Sharing System API endpoints.
Handles task sharing, access control, and shared file downloads.
"""
import io
import os
import zipfile
from urllib.parse import urlencode
from typing import Optional

from fastapi import APIRouter, Depends, Query
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.config import settings
from app.shared.file_kinds import FileKind
from app.shared.constants import ErrorCode, SuccessCode
from app.core.exceptions import FileException, ResourceNotFoundException
from app.db.models import User
from app.db.model_utils import require_persisted_id
from app.modules.shares.dependencies import get_share_service
from app.modules.shares.schemas import (
    BatchDeleteSavedSharesRequest,
    CreateShareRequest,
    SaveShareRequest,
)
from app.modules.shares.service import ShareService
from app.storage import file_storage
from app.storage.paths import materialize_storage_key
from app.shared.responses import paginated_response, success_response

router = APIRouter()


@router.get("")
async def list_shares(
    task_id: Optional[str] = None,
    page: int = Query(1, ge=1),
    page_size: int = Query(20, ge=1, le=100),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    share_service: ShareService = Depends(get_share_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await share_service.list_shares(
        db,
        user_id,
        task_id=task_id,
        page=page,
        page_size=page_size,
    )
    return success_response(data=result)


@router.post("")
async def create_share_link(
    request: CreateShareRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    share_service: ShareService = Depends(get_share_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await share_service.create_share(
        db,
        user_id,
        task_id=request.task_id,
        expires_in_days=request.expires_in_days,
    )
    return success_response(data=result, message=SuccessCode.SHARE_CREATED)


@router.delete("/{share_token}")
async def remove_share(
    share_token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    share_service: ShareService = Depends(get_share_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    await share_service.remove_share(db, share_token, user_id)
    return success_response(message=SuccessCode.SHARE_REMOVED)


@router.post("/{share_token}/revoke")
async def revoke_share(
    share_token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    share_service: ShareService = Depends(get_share_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await share_service.revoke_share(db, share_token, user_id)
    return success_response(data=result)


@router.get("/saved-shares")
async def list_saved_shares(
    page: int = Query(1, ge=1, description="Page number"),
    page_size: int = Query(20, ge=1, le=100, description="Items per page"),
    sort_by: str = Query("created_at", description="Sort by: created_at, title"),
    sort_order: str = Query("desc", description="Sort order: asc, desc"),
    search: Optional[str] = Query(None, description="Search by task title"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    share_service: ShareService = Depends(get_share_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await share_service.list_saved_shares(
        db,
        user_id,
        page=page,
        page_size=page_size,
        sort_by=sort_by,
        sort_order=sort_order,
        search=search,
    )
    return paginated_response(
        data=result["items"],
        page=page,
        page_size=page_size,
        total=result["total"],
    )


@router.get("/{share_token}")
async def access_shared_task(
    share_token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    share_service: ShareService = Depends(get_share_service),
):
    result = await share_service.access_share(db, share_token)
    return success_response(data=result)


@router.get("/{share_token}/download/archive")
async def download_shared_archive(
    share_token: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    share_service: ShareService = Depends(get_share_service),
):
    files = await share_service.list_download_files(db, share_token, FileKind.FINAL_IMAGE)
    if not files:
        raise ResourceNotFoundException(
            resource_type="image",
            resource_id=share_token,
            code=ErrorCode.FILE_NOT_FOUND,
        )

    bio = io.BytesIO()
    with zipfile.ZipFile(bio, "w", zipfile.ZIP_DEFLATED) as zf:
        for idx, file in enumerate(files, 1):
            file_path = materialize_storage_key(file["storage_key"])
            if os.path.exists(file_path):
                zf.write(file_path, f"page-{idx:02d}.png")

    bio.seek(0)
    filename = f"score_{share_token[:8]}.zip"
    return StreamingResponse(
        bio,
        media_type="application/zip",
        headers={
            "Content-Disposition": f"attachment; filename={filename}",
            "X-Page-Count": str(len(files)),
        },
    )


@router.get("/{share_token}/download/{file_type}")
async def download_shared_file(
    share_token: str,
    file_type: str,
    page: int = Query(default=1, ge=1, description="Page number for multi-page files"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    share_service: ShareService = Depends(get_share_service),
):
    files = await share_service.list_download_files(db, share_token, file_type)
    if not files:
        raise ResourceNotFoundException(
            resource_type=file_type,
            resource_id=share_token,
            code=ErrorCode.FILE_NOT_FOUND,
        )

    page = min(page, len(files))
    file = files[page - 1]
    filename = file["filename"]
    media_type = file["mime_type"] or "application/octet-stream"
    if file_storage.backend_name != "local":
        try:
            if not file_storage.exists(file["storage_key"]):
                raise FileNotFoundError(file["storage_key"])
            redirect_url = file_storage.download_url(
                file["storage_key"],
                filename=filename,
                content_type=media_type,
            )
            if not redirect_url:
                raise FileNotFoundError(file["storage_key"])
            return RedirectResponse(redirect_url, status_code=302)
        except FileNotFoundError:
            raise FileException(code=ErrorCode.FILE_NOT_FOUND, filename=file["storage_key"])

    file_path = materialize_storage_key(file["storage_key"])
    if not os.path.exists(file_path):
        raise FileException(code=ErrorCode.FILE_NOT_FOUND, filename=file_path)

    return FileResponse(
        path=file_path,
        filename=os.path.basename(file_path),
        media_type=media_type,
    )


@router.get("/{share_token}/access-url/{file_type}")
async def get_shared_file_access_url(
    share_token: str,
    file_type: str,
    page: int = Query(default=1, ge=1, description="Page number for multi-page files"),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    share_service: ShareService = Depends(get_share_service),
):
    files = await share_service.list_download_files(db, share_token, file_type)
    if not files:
        raise ResourceNotFoundException(
            resource_type=file_type,
            resource_id=share_token,
            code=ErrorCode.FILE_NOT_FOUND,
        )

    page = min(page, len(files))
    file = files[page - 1]
    media_type = file["mime_type"] or "application/octet-stream"
    if file_storage.backend_name != "local":
        try:
            if not file_storage.exists(file["storage_key"]):
                raise FileNotFoundError(file["storage_key"])
            url = file_storage.download_url(file["storage_key"])
            if not url:
                raise FileNotFoundError(file["storage_key"])
        except FileNotFoundError:
            raise FileException(code=ErrorCode.FILE_NOT_FOUND, filename=file["storage_key"])
        expires_in = settings.S3_PRESIGN_EXPIRE_SECONDS
    else:
        query = urlencode({"page": page})
        url = f"{settings.API_V1_STR}/shares/{share_token}/download/{file_type}?{query}"
        expires_in = None

    return success_response(
        data={
            "url": url,
            "filename": file["filename"],
            "mime_type": media_type,
            "expires_in": expires_in,
        }
    )


@router.post("/save")
async def save_share_to_collection(
    request: SaveShareRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    share_service: ShareService = Depends(get_share_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    is_new = await share_service.save_to_collection(db, request.token, user_id)
    if is_new:
        return success_response(message=SuccessCode.SHARE_SAVED)
    return success_response(message=SuccessCode.SHARE_ALREADY_SAVED)


@router.post("/saved-shares/batch-delete")
async def batch_delete_saved_shares(
    request: BatchDeleteSavedSharesRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    share_service: ShareService = Depends(get_share_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    deleted_count = await share_service.batch_delete_saved(db, request.ids, user_id)
    return success_response(
        data={"deleted_count": deleted_count},
        message=SuccessCode.SHARES_DELETED,
    )
