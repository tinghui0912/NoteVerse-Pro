"""Generic upload admission allowlist settings."""

from pydantic import BaseModel, field_validator


class UploadAdmissionSettings(BaseModel):
    """File-extension policy for generic score-processing uploads."""

    ALLOWED_EXTENSIONS: frozenset[str] = frozenset(
        {"png", "jpg", "jpeg", "bmp", "gif", "webp", "tiff", "tif"}
    )

    @field_validator("ALLOWED_EXTENSIONS")
    @classmethod
    def validate_allowed_extensions(cls, value: frozenset[str]) -> frozenset[str]:
        if not value:
            raise ValueError("ALLOWED_EXTENSIONS must not be empty")
        if any(not extension or extension.startswith(".") or extension != extension.lower() for extension in value):
            raise ValueError("ALLOWED_EXTENSIONS must contain lowercase extensions without dots")
        return value
