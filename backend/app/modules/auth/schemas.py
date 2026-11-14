"""Canonical Pydantic schemas for the auth module."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, EmailStr, Field, field_validator, model_validator
from app.shared.api_model import ApiModel


class TokenPayload(BaseModel):
    sub: str
    exp: int
    iat: int
    jti: str
    typ: str


class RegisterRequest(BaseModel):
    email: EmailStr = Field(..., description="Email address")
    password: str = Field(..., min_length=6, max_length=128, description="Password")
    display_name: str = Field(..., min_length=1, max_length=50, description="Display name")
    locale: Literal["en", "zh"] = "zh"


class VerifyEmailRequest(BaseModel):
    token: str = Field(..., min_length=1, description="Email verification token")


class RequestEmailChangeRequest(BaseModel):
    new_email: EmailStr = Field(..., description="New email address")
    current_password: str = Field(..., min_length=1, description="Current password")
    locale: Literal["en", "zh"] = "zh"


class ConfirmEmailChangeRequest(BaseModel):
    token: str = Field(..., min_length=1, description="Email change confirmation token")


class EmailChangeConfirmedRead(ApiModel):
    email: EmailStr


class ForgotPasswordRequest(BaseModel):
    email: EmailStr = Field(..., description="Email address")
    locale: Literal["en", "zh"] = "zh"


class ResetPasswordRequest(BaseModel):
    new_password: str = Field(..., min_length=6, max_length=128, description="New password")
    token: str = Field(..., min_length=1, description="Password reset token")
    locale: Literal["en", "zh"] = "zh"


class ChangePasswordRequest(BaseModel):
    current_password: str = Field(..., min_length=1, description="Current password")
    new_password: str = Field(..., min_length=6, max_length=128, description="New password")
    locale: Literal["en", "zh"] = "zh"

    @field_validator("new_password")
    @classmethod
    def validate_new_password(cls, value: str, info) -> str:
        current_password = info.data.get("current_password")
        if current_password and value == current_password:
            raise ValueError("New password must differ from the current password")
        return value


class SessionSummary(BaseModel):
    id: int
    device_id: str | None = None
    user_agent: str | None = None
    ip_address: str | None = None
    created_at: datetime
    last_used_at: datetime | None = None
    expires_at: datetime
    is_current: bool = False


class SecurityOverview(BaseModel):
    email: EmailStr
    email_verified_at: datetime | None = None
    password_changed_at: datetime | None = None
    mfa_enabled: bool = False
    mfa_available: bool = False


class SessionsRead(ApiModel):
    sessions: list[SessionSummary]


class SecurityRead(ApiModel):
    security: SecurityOverview


class User(ApiModel):
    """Customer identity returned after email verification.

    Platform authorization belongs exclusively to the isolated control-plane
    operator principal and is never represented on a customer user.
    """

    model_config = ConfigDict(from_attributes=True)

    id: int | None = None
    email: EmailStr | None = None
    display_name: str | None = None
    is_active: bool | None = True
    created_at: datetime | None = None
    updated_at: datetime | None = None
    avatar_url: str | None = None
    email_verified_at: datetime | None = None

    @model_validator(mode="before")
    @classmethod
    def project_user(cls, value):
        from app.db.models import User as UserRecord
        from app.modules.account.avatar_presentation import avatar_url_for_user

        if isinstance(value, UserRecord):
            return {
                **{name: getattr(value, name) for name in cls.model_fields if name != "avatar_url"},
                "avatar_url": avatar_url_for_user(value),
            }
        return value


__all__ = [
    "ChangePasswordRequest",
    "ConfirmEmailChangeRequest",
    "EmailChangeConfirmedRead",
    "ForgotPasswordRequest",
    "RegisterRequest",
    "RequestEmailChangeRequest",
    "ResetPasswordRequest",
    "SecurityRead",
    "SessionsRead",
    "TokenPayload",
    "User",
    "VerifyEmailRequest",
]
