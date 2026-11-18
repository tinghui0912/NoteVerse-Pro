from __future__ import annotations

from app.shared.pagination import CursorPage
from app.shared.time import Instant
from typing import Annotated, Literal
from pydantic import BaseModel, Field
from app.shared.api_model import ApiModel


class NotificationActorRead(BaseModel):
    display_name: str | None
    email: str
    avatar_url: str | None


class NotificationBaseRead(ApiModel):
    notification_id: str
    read_at: Instant | None
    created_at: Instant


class ScoreInviteAcceptedNotificationRead(NotificationBaseRead):
    kind: Literal["score_invite.accepted"]
    invite_id: str
    actor: NotificationActorRead
    score_id: str
    score_display_title: str


class ScoreInviteDeclinedNotificationRead(NotificationBaseRead):
    kind: Literal["score_invite.declined"]
    invite_id: str
    actor: NotificationActorRead
    score_id: str
    score_display_title: str


class ScoreVersionCreatedNotificationRead(NotificationBaseRead):
    kind: Literal["score.version.created"]
    actor: NotificationActorRead
    score_id: str
    score_display_title: str
    revision_id: str


class ImportReadyForReviewNotificationRead(NotificationBaseRead):
    kind: Literal["import.ready_for_review"]
    job_id: str
    import_display_title: str | None
    score_id: str | None
    score_display_title: str | None


class ImportFailedNotificationRead(NotificationBaseRead):
    kind: Literal["import.failed"]
    job_id: str
    import_display_title: str | None


type NotificationRead = Annotated[
    ScoreInviteAcceptedNotificationRead
    | ScoreInviteDeclinedNotificationRead
    | ScoreVersionCreatedNotificationRead
    | ImportReadyForReviewNotificationRead
    | ImportFailedNotificationRead,
    Field(discriminator="kind"),
]


class NotificationUnreadCountRead(ApiModel):
    count: int


class NotificationListRead(CursorPage[NotificationRead]):
    next_cursor: str | None
