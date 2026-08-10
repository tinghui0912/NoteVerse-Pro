"""Shared service identity and customer API routing settings."""

from pydantic import BaseModel, field_validator


# Customer API routing is a versioned source contract. Deployment topology must
# use ingress/root-path configuration rather than changing this public prefix.
CUSTOMER_API_PREFIX = "/api/v1"


class ServiceIdentitySettings(BaseModel):
    """Names the product and its customer-facing API mount point."""

    PROJECT_NAME: str = "NoteVerse Pro"
    DEBUG: bool = False

    @field_validator("PROJECT_NAME")
    @classmethod
    def validate_project_name(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("PROJECT_NAME must not be blank")
        return value

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug_flag(cls, value: object) -> object:
        """Allow environment-style debug labels in addition to booleans."""

        if isinstance(value, bool):
            return value
        if isinstance(value, str):
            normalized_value = value.strip().lower()
            if normalized_value in {"1", "true", "yes", "on", "debug", "development", "dev"}:
                return True
            if normalized_value in {"0", "false", "no", "off", "release", "production", "prod"}:
                return False
        return value
