from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
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
    "/upload-authorizations/{reservation_id}/cancel",
    response_model=APIResponse[dict[str, bool]],
)
async def cancel_take_upload_authorization(
    reservation_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    await service.cancel_upload_authorization(db, user_id, reservation_id)
    return success_response(data={"cancelled": True})


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
    score_id: Optional[str] = Query(default=None),
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
