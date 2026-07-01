from __future__ import annotations

from datetime import datetime

from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.db.models.score_access import InviteStatus, MembershipRole


class InviteActorRead(BaseModel):
    display_name: str | None
    email: str
    avatar_url: str | None


class InviteCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: EmailStr = Field(max_length=255)
    role: MembershipRole = MembershipRole.EDITOR
    expires_at: datetime | None = None
    locale: Literal["en", "zh"] = "zh"

    @field_validator("email")
    @classmethod
    def normalize_email(cls, value: EmailStr) -> str:
        return str(value).strip().lower()


class InviteRead(BaseModel):
    invite_id: str
    email: str | None
    role: MembershipRole
    status: InviteStatus
    expires_at: datetime | None
    accepted_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime
    created_by: InviteActorRead | None
    accepted_by: InviteActorRead | None


class InviteCreatedRead(InviteRead):
    token: str


class InviteAccessRead(BaseModel):
    invite_id: str
    score_id: str
    score_title: str
    inviter: InviteActorRead | None
    email: str | None
    role: MembershipRole
    status: InviteStatus
    expires_at: datetime | None
    requires_login: bool
    can_accept: bool


class InviteAcceptRead(BaseModel):
    score_id: str
    role: MembershipRole
    membership_id: int | None


class MemberRead(BaseModel):
    membership_id: int
    user_id: int
    display_name: str | None
    email: str
    avatar_url: str | None
    role: MembershipRole
    created_at: datetime
    revoked_at: datetime | None


class MemberUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    role: MembershipRole
