from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import get_current_user, get_db
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.notifications.dependencies import get_notification_service
from app.modules.notifications.schemas import NotificationEventRead, NotificationUnreadCountRead
from app.modules.notifications.service import NotificationService
from app.shared.responses import APIResponse, success_response

router = APIRouter()


@router.get("/notifications", response_model=APIResponse[list[NotificationEventRead]])
async def list_my_notifications(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: NotificationService = Depends(get_notification_service),
    limit: int = Query(default=50, ge=1, le=100),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.list_for_user(db, user_id, limit=limit)
    return success_response(data=result)


@router.get("/notifications/unread-count", response_model=APIResponse[NotificationUnreadCountRead])
async def my_notification_unread_count(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: NotificationService = Depends(get_notification_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.unread_count(db, user_id)
    return success_response(data=result)


@router.post("/notifications/{notification_id}/read", response_model=APIResponse[NotificationEventRead])
async def mark_my_notification_read(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: NotificationService = Depends(get_notification_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.mark_read(db, notification_id, user_id)
    return success_response(data=result)


@router.post("/notifications/read-all", response_model=APIResponse[NotificationUnreadCountRead])
async def mark_all_my_notifications_read(
    current_user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
    service: NotificationService = Depends(get_notification_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = await service.mark_all_read(db, user_id)
    return success_response(data=result)
