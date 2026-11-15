from __future__ import annotations


from app.shared.time import Instant

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.db.models.score_access import MembershipRole
from app.modules.score_invites.lifecycle import InviteStatus
from app.shared.pagination import CursorPage
from app.shared.api_model import ApiModel


class InviteActorRead(BaseModel):
    display_name: str | None
    email: str
    avatar_url: str | None


class InviteCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=255)
    role: MembershipRole = MembershipRole.VIEWER
    expires_at: Instant | None = None
    locale: Literal["en", "zh"] = "zh"

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class InviteRead(ApiModel):
    invite_id: str
    email: str | None
    role: MembershipRole
    status: InviteStatus
    expires_at: Instant | None
    terminal_at: Instant | None
    created_at: Instant
    created_by: InviteActorRead | None
    terminal_actor: InviteActorRead | None


class InviteCreatedRead(InviteRead):
    token: str


class PendingInviteRead(ApiModel):
    invite_id: str
    score_id: str
    score_display_title: str
    inviter: InviteActorRead | None
    email: str | None
    role: MembershipRole
    status: InviteStatus
    expires_at: Instant | None
    created_at: Instant


class InviteAccessRead(ApiModel):
    invite_id: str
    score_id: str
    score_display_title: str
    inviter: InviteActorRead | None
    email: str | None
    role: MembershipRole
    status: InviteStatus
    expires_at: Instant | None
    requires_login: bool
    can_accept: bool


class InviteAcceptRead(ApiModel):
    score_id: str
    role: MembershipRole
    membership_id: int | None


class MemberRead(ApiModel):
    membership_id: int
    display_name: str | None
    email: str
    avatar_url: str | None
    role: MembershipRole
    created_at: Instant
    revoked_at: Instant | None


class MemberUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: MembershipRole


class InviteListRead(CursorPage[InviteRead]):
    next_cursor: str | None


class MemberListRead(CursorPage[MemberRead]):
    next_cursor: str | None


class PendingInviteListRead(CursorPage[PendingInviteRead]):
    next_cursor: str | None
