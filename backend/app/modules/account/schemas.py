"""Account request and response schemas."""

from datetime import datetime

from pydantic import BaseModel, EmailStr, Field


class UpdateProfileRequest(BaseModel):
    display_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=50,
        description="Display name",
    )


class ProfileUserRead(BaseModel):
    id: int
    email: EmailStr
    display_name: str
    created_at: datetime | None = None
    is_active: bool
    avatar_url: str | None = None


class ProfileRead(BaseModel):
    user: ProfileUserRead


class ProfileUpdateRead(BaseModel):
    updated_fields: list[str]


class AvatarRead(BaseModel):
    avatar_url: str
    filename: str
