from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from app.platform.db.dependencies import get_command_db, get_db
from app.runtime.customer_api.deps import get_current_user
from app.db.model_utils import require_persisted_id
from app.db.models import User
from app.modules.notifications.dependencies import get_notification_service
from app.modules.notifications.schemas import (
    NotificationRead,
    NotificationUnreadCountRead,
    NotificationListRead,
)
from app.modules.notifications.service import NotificationService


router = APIRouter()


@router.get(
    "/notifications",
    operation_id="notificationsList",
    response_model=NotificationListRead,
)
def list_my_notifications(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: NotificationService = Depends(get_notification_service),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: str | None = Query(default=None),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.list_for_user(db, user_id, limit=limit, cursor=cursor)
    return result


@router.get(
    "/notifications/unread-count",
    operation_id="notificationsUnreadCountGet",
    response_model=NotificationUnreadCountRead,
)
def my_notification_unread_count(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db, scope="function"),
    service: NotificationService = Depends(get_notification_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.unread_count(db, user_id)
    return result


@router.post(
    "/notifications/{notification_id}/read",
    operation_id="notificationMarkRead",
    response_model=NotificationRead,
)
def mark_my_notification_read(
    notification_id: str,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_command_db, scope="function"),
    service: NotificationService = Depends(get_notification_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.mark_read(db, notification_id, user_id)
    return result


@router.post(
    "/notifications/read-all",
    operation_id="notificationsMarkAllRead",
    response_model=NotificationUnreadCountRead,
)
def mark_all_my_notifications_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_command_db, scope="function"),
    service: NotificationService = Depends(get_notification_service),
):
    user_id = require_persisted_id(current_user.id, entity="user")
    result = service.mark_all_read(db, user_id)
    return result
