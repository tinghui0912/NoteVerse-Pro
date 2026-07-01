"""Canonical Pydantic schemas for the auth module."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator

from app.db.models.user import UserRole


class TokenPayload(BaseModel):
    sub: str
    exp: int
    iat: int
    jti: str
    typ: str


class SendCodeRequest(BaseModel):
    email: EmailStr = Field(..., description="Email address")
    purpose: Literal["register", "password_reset"] = Field(
        default="register",
        description="Verification code purpose",
    )
    locale: Literal["en", "zh"] = "zh"


class VerifyCodeRequest(BaseModel):
    email: EmailStr = Field(..., description="Email address")
    code: str = Field(..., min_length=6, max_length=6, description="6-digit code")
    challenge_id: str = Field(..., min_length=1, description="Challenge ID")

    @field_validator("code")
    @classmethod
    def validate_code_format(cls, value: str) -> str:
        if not value.isdigit():
            raise ValueError("Verification code must be a 6-digit number")
        return value


class RegisterRequest(BaseModel):
    email: EmailStr = Field(..., description="Email address")
    password: str = Field(..., min_length=6, max_length=128, description="Password")
    display_name: str = Field(..., min_length=1, max_length=50, description="Display name")
    verified_token: str = Field(..., min_length=1, description="Email verification token")


class ResetPasswordRequest(BaseModel):
    email: EmailStr = Field(..., description="Email address")
    new_password: str = Field(..., min_length=6, max_length=128, description="New password")
    reset_token: str = Field(..., min_length=1, description="Password reset token")


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, description="Current password")
    new_password: str = Field(..., min_length=6, max_length=128, description="New password")

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str, info) -> str:
        current_password = info.data.get("current_password")
        if current_password and value == current_password:
            raise ValueError("New password must differ from the current password")
        return value


class UserBase(BaseModel):
    email: EmailStr | None = None
    display_name: str | None = None
    is_active: bool | None = True
    role: UserRole = UserRole.user


class UserCreate(UserBase):
    email: EmailStr
    password: str
    display_name: str


class UserUpdate(UserBase):
    password: str | None = None


class UserInDBBase(UserBase):
    model_config = ConfigDict(from_attributes=True)

    id: int | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None
    avatar_url: str | None = None


class User(UserInDBBase):
    pass


class UserInDB(UserInDBBase):
    password_hash: str


class SendCodeResult(BaseModel):
    challenge_id: str
    cooldown: int


__all__ = [
    "ChangePasswordRequest",
    "RegisterRequest",
    "ResetPasswordRequest",
    "SendCodeResult",
    "SendCodeRequest",
    "TokenPayload",
    "User",
    "UserBase",
    "UserCreate",
    "UserInDB",
    "UserInDBBase",
    "UserUpdate",
    "VerifyCodeRequest",
]
