"""Customer browser CORS origin settings."""

from pydantic import AnyHttpUrl, BaseModel, field_validator


class BrowserCorsSettings(BaseModel):
    """CORS origins shared by customer API and Practice HTTP surfaces."""

    BACKEND_CORS_ORIGINS: list[AnyHttpUrl]

    @field_validator("BACKEND_CORS_ORIGINS", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: str | list[str]) -> list[str]:
        if value in (None, ""):
            return []
        if isinstance(value, list):
            return value
        raise ValueError("BACKEND_CORS_ORIGINS must be a JSON array")
