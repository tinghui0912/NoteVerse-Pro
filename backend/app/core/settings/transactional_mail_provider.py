"""Transactional mail-provider connection settings."""

from typing import Self
from urllib.parse import urlparse

from pydantic import BaseModel, model_validator


class TransactionalMailProviderSettings(BaseModel):
    """Resend transport configuration, with an explicit disabled state."""

    MAIL_DEFAULT_SENDER: str | None = None
    RESEND_API_KEY: str | None = None
    RESEND_API_URL: str = "https://api.resend.com/emails"

    @model_validator(mode="after")
    def validate_provider_configuration(self) -> Self:
        has_sender = bool(self.MAIL_DEFAULT_SENDER)
        has_api_key = bool(self.RESEND_API_KEY)
        if has_sender != has_api_key:
            raise ValueError(
                "MAIL_DEFAULT_SENDER and RESEND_API_KEY must be configured together"
            )

        parsed_url = urlparse(self.RESEND_API_URL)
        if parsed_url.scheme not in {"http", "https"} or not parsed_url.netloc:
            raise ValueError("RESEND_API_URL must be an absolute HTTP(S) URL")
        return self
