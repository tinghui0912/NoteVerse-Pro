"""Consumer session lifetime and cookie transport policy."""

from pydantic import BaseModel, Field


class CustomerSessionSecuritySettings(BaseModel):
    AUTH_COOKIE_SECURE: bool
    SESSION_IDLE_DAYS: int = Field(default=14, gt=0, le=14)
    SESSION_ABSOLUTE_DAYS: int = Field(default=30, gt=0, le=30)
    SESSION_TOUCH_INTERVAL_SECONDS: int = Field(default=600, ge=300, le=900)
    SESSION_CACHE_TTL_SECONDS: int = Field(default=120, ge=60, le=180)
