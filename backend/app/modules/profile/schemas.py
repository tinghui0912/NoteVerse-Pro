"""
Profile request schemas for the profile module.
"""
from typing import Optional

from pydantic import BaseModel, EmailStr, Field, model_validator


class UpdateProfileRequest(BaseModel):
    display_name: Optional[str] = Field(
        default=None,
        min_length=1,
        max_length=50,
        description="Display name",
    )
    email: Optional[EmailStr] = Field(default=None, description="Email address")
    current_password: Optional[str] = Field(
        default=None,
        description="Current password required when changing password",
    )
    new_password: Optional[str] = Field(
        default=None,
        min_length=6,
        max_length=128,
        description="New password, 6-128 characters",
    )

    @model_validator(mode="after")
    def validate_password_fields(self):
        if self.new_password and not self.current_password:
            raise ValueError("Current password is required when changing password")
        return self


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, description="Current password")
    new_password: str = Field(
        ...,
        min_length=6,
        max_length=128,
        description="New password, 6-128 characters",
    )
