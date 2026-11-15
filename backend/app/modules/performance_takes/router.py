from __future__ import annotations

from typing import Optional

from fastapi.responses import Response
from app.api.response_contracts import binary_responses
from fastapi import APIRouter, Depends, Query, Request
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, get_db
from app.api.storage_streaming import stream_storage_object
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.performance_takes.dependencies import (
    get_performance_take_service,
    get_performance_take_reservation_service,
    get_performance_take_finalization_service,
)
from app.modules.performance_takes.upload_reservation.reservation_service import (
    PerformanceTakeReservationService,
)
from app.modules.performance_takes.finalization import PerformanceTakeFinalizationService
from app.modules.performance_takes.schemas import (
    PerformanceTakeListResponse,
    PerformanceTakePlaybackRead,
    PerformanceTakeRead,
    PerformanceTakeUploadReservationRead,
    PerformanceTakeUploadReservationRequest,
)
from app.modules.performance_takes.service import PerformanceTakeService

from app.core.exceptions import ValidationException
from app.shared.error_codes import ErrorCode

router = APIRouter()


@router.post(
    "/upload-reservations",
    operation_id="performanceTakeUploadsReserve",
    response_model=PerformanceTakeUploadReservationRead,
)
def reserve_take_upload(
    request: PerformanceTakeUploadReservationRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: PerformanceTakeReservationService = Depends(get_performance_take_reservation_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    data = service.reserve_upload(db, user_id, request)
    return data


@router.delete(
    "/upload-reservations/{reservation_id}",
    operation_id="performanceTakeUploadCancel",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def cancel_take_upload_reservation(
    reservation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: PerformanceTakeReservationService = Depends(get_performance_take_reservation_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    service.cancel_upload_reservation(db, user_id, reservation_id)
    return Response(status_code=204)


async def require_empty_finalize_body(http_request: Request) -> None:
    if await http_request.body():
        raise ValidationException(ErrorCode.VALIDATION_ERROR, field="body")


@router.post(
    "/upload-reservations/{reservation_id}/finalize",
    operation_id="performanceTakeUploadFinalize",
    dependencies=[Depends(require_empty_finalize_body)],
    response_model=PerformanceTakeRead,
)
def finalize_take(
    reservation_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: PerformanceTakeFinalizationService = Depends(
        get_performance_take_finalization_service
    ),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    data = service.finalize_take(db, user_id, reservation_id)
    return data


@router.get(
    "",
    operation_id="performanceTakesList",
    response_model=PerformanceTakeListResponse,
)
def list_takes(
    score_id: Optional[str] = Query(default=None),
    limit: int = Query(default=50, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    data = service.list_takes(db, user_id, score_id=score_id, limit=limit, offset=offset)
    return data


@router.get(
    "/{take_id}",
    operation_id="performanceTakeGet",
    response_model=PerformanceTakeRead,
)
def get_take(
    take_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    data = service.get_take(db, user_id, take_id)
    return data


@router.get(
    "/{take_id}/playback-url",
    operation_id="performanceTakePlaybackUrlGet",
    response_model=PerformanceTakePlaybackRead,
)
def get_playback_url(
    take_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    data = service.get_playback_url(db, user_id, take_id)
    return data


@router.get(
    "/{take_id}/media",
    response_class=Response,
    responses=binary_responses("audio/*", "video/*", byte_ranges=True),
    operation_id="performanceTakeMediaStream",
)
def stream_take_media(
    take_id: str,
    request: Request,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    storage_key, filename, media_type = service.get_media_delivery(db, user_id, take_id)
    return stream_storage_object(
        storage=service.storage,
        storage_key=storage_key,
        filename=filename,
        media_type=media_type,
        attachment=False,
        request=request,
        enable_range=True,
    )


@router.delete(
    "/{take_id}",
    operation_id="performanceTakeDelete",
    status_code=204,
    response_model=None,
    response_class=Response,
)
def delete_take(
    take_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: PerformanceTakeService = Depends(get_performance_take_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    service.delete_take(db, user_id, take_id)
    return Response(status_code=204)
