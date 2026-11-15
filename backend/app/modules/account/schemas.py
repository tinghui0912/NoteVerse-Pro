"""Account request and response schemas."""

from app.shared.time import Instant

from pydantic import BaseModel, EmailStr, Field
from app.shared.api_model import ApiModel


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
    created_at: Instant | None = None
    is_active: bool
    avatar_url: str | None = None


class ProfileRead(ApiModel):
    user: ProfileUserRead


class AvatarRead(ApiModel):
    avatar_url: str
    filename: str
