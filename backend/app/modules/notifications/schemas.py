from __future__ import annotations


from datetime import datetime
from typing import Any

from pydantic import BaseModel
from app.shared.api_model import ApiModel


class NotificationActorRead(BaseModel):
    display_name: str | None
    email: str
    avatar_url: str | None


class NotificationEventRead(ApiModel):
    notification_id: str
    type: str
    title: str
    body: str | None
    score_id: str | None
    actor: NotificationActorRead | None
    data: dict[str, Any]
    read_at: datetime | None
    created_at: datetime


class NotificationUnreadCountRead(ApiModel):
    count: int
