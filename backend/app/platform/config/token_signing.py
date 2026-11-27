"""JWT token-signing secret settings."""

from pydantic import BaseModel, field_validator


class TokenSigningSettings(BaseModel):
    """Secret material used to sign and verify customer authentication tokens."""

    SECRET_KEY: str

    @field_validator("SECRET_KEY")
    @classmethod
    def validate_secret_key(cls, value: str) -> str:
        if len(value) < 32 or value.isspace():
            raise ValueError("SECRET_KEY must be at least 32 non-whitespace characters long")
        return value
