from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query, Request, Response
from fastapi.responses import StreamingResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.core.exceptions import ResourceNotFoundException, ValidationException
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.performance_takes.dependencies import get_performance_take_service
from app.modules.performance_takes.schemas import (
    PerformanceTakeCreateRequest,
    PerformanceTakeListResponse,
    PerformanceTakePlaybackRead,
    PerformanceTakeRead,
    PerformanceTakeUploadAuthorizationRead,
    PerformanceTakeUploadAuthorizationRequest,
)
from app.modules.performance_takes.service import PerformanceTakeService
from app.shared.constants import ErrorCode
from app.shared.responses import APIResponse, success_response

router = APIRouter()


@router.post(
    "/upload-authorizations",
    response_model=APIResponse[PerformanceTakeUploadAuthorizationRead],
)
async def authorize_take_upload(
    request: PerformanceTakeUploadAuthorizationRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    data = await service.authorize_upload(db, user_id, request)
    return success_response(data=data)


@router.post(
    "",
    response_model=APIResponse[PerformanceTakeRead],
)
async def finalize_take(
    request: PerformanceTakeCreateRequest,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    data = await service.finalize_take(db, user_id, request)
    return success_response(data=data)


@router.get(
    "",
    response_model=APIResponse[PerformanceTakeListResponse],
)
async def list_takes(
    score_id: Optional[int] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    data = await service.list_takes(
        db, user_id, score_id=score_id, limit=limit, offset=offset
    )
    return success_response(data=data)


@router.get(
    "/{take_id}",
    response_model=APIResponse[PerformanceTakeRead],
)
async def get_take(
    take_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    data = await service.get_take(db, user_id, take_id)
    return success_response(data=data)


@router.get(
    "/{take_id}/playback-url",
    response_model=APIResponse[PerformanceTakePlaybackRead],
)
async def get_playback_url(
    take_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    data = await service.get_playback_url(db, user_id, take_id)
    return success_response(data=data)


@router.delete(
    "/{take_id}",
    response_model=APIResponse[dict[str, bool]],
)
async def delete_take(
    take_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    await service.delete_take(db, user_id, take_id)
    return success_response(data={"deleted": True})


@router.put("/local-uploads/{take_uuid}")
async def upload_local_take_media(
    take_uuid: str,
    raw_request: Request,
    mime_type: str = Query(default="audio/webm"),
    current_user: User = Depends(get_current_user),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    content = await raw_request.body()
    if not content:
        raise ValidationException(code=ErrorCode.VALIDATION_ERROR, field="body")
    await service.upload_take_object_for_local_storage(
        user_id,
        take_uuid,
        content=content,
        mime_type=mime_type,
    )
    return Response(status_code=200)


@router.get("/{take_id}/media")
async def stream_local_take_media(
    take_id: str,
    download: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    take = await service.get_take(db, user_id, take_id)
    key = service._build_object_key(user_id, take.take_id, take.media_mime_type)
    if not service.storage.exists(key):
        raise ResourceNotFoundException("performance_take_media_file", take_id, ErrorCode.FILE_NOT_FOUND)

    headers = {}
    if download:
        ext = service.media_mime_type if hasattr(service, "media_mime_type") else "webm"
        headers["Content-Disposition"] = f'attachment; filename="performance-{take_id}.webm"'

    return StreamingResponse(
        service.storage.iter_bytes(key),
        media_type=take.media_mime_type,
        headers=headers,
    )
