"""Customer browser CORS origin settings."""

from pydantic import BaseModel, field_validator
from app.platform.security.origin_guard import normalize_origin


class BrowserCorsSettings(BaseModel):
    """Exact browser origin allowlist for the Customer HTTP runtime."""

    BACKEND_CORS_ORIGINS: list[str]

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if value in (None, ""):
            return []
        if isinstance(value, list):
            return [normalize_origin(origin) for origin in value]
        raise ValueError("BACKEND_CORS_ORIGINS must be a JSON array")
