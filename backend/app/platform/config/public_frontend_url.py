"""Public frontend URL settings for externally delivered links."""

from urllib.parse import urlparse

from pydantic import BaseModel, field_validator


class PublicFrontendUrlSettings(BaseModel):
    """Absolute browser URL used by account and score-invitation links."""

    FRONTEND_BASE_URL: str

    @field_validator("FRONTEND_BASE_URL")
    @classmethod
    def validate_frontend_base_url(cls, value: str) -> str:
        parsed_url = urlparse(value)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            raise ValueError("FRONTEND_BASE_URL must be an absolute HTTP(S) URL")
        if parsed_url.query or parsed_url.fragment:
            raise ValueError("FRONTEND_BASE_URL must not contain a query or fragment")
        return value
