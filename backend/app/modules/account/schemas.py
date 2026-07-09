"""Account request schemas."""

from pydantic import BaseModel, Field


class UpdateProfileRequest(BaseModel):
    display_name: str | None = Field(
        default=None,
        min_length=1,
        max_length=50,
        description="Display name",
    )
