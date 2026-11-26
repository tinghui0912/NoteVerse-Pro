"""Durable object storage and local runtime-directory settings."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional, Self

from pydantic import BaseModel, Field, field_validator, model_validator


class StorageSettings(BaseModel):
    S3_ENDPOINT_URL: Optional[str] = None
    S3_SIGNED_ENDPOINT_URL: Optional[str] = None
    S3_REGION: str = "auto"
    S3_BUCKET: Optional[str] = None
    S3_ACCESS_KEY_ID: Optional[str] = None
    S3_SECRET_ACCESS_KEY: Optional[str] = None
    S3_FORCE_PATH_STYLE: bool = True
    OBJECT_STORAGE_SIGNED_URL_EXPIRE_SECONDS: int = Field(default=900, gt=0)
    AVATAR_MAX_UPLOAD_BYTES: int = Field(default=5 * 1024 * 1024, gt=0, le=5 * 1024 * 1024)
    AVATAR_MAX_PIXELS: int = Field(default=16_000_000, gt=0)
    AVATAR_MAX_DIMENSION: int = Field(default=8192, gt=0)
    WORK_ROOT: str = "data/work"

    @field_validator("WORK_ROOT")
    @classmethod
    def resolve_runtime_folders(cls, value: str) -> str:
        path = Path(value)
        if not os.path.isabs(value):
            path = (Path(__file__).resolve().parents[3] / path).resolve()
        if path.exists() and not path.is_dir():
            raise ValueError(f"{value} exists but is not a directory")
        return str(path)

    @field_validator("S3_ENDPOINT_URL", "S3_SIGNED_ENDPOINT_URL")
    @classmethod
    def normalize_optional_url(cls, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        normalized = value.strip().rstrip("/")
        return (
            normalized
            if normalized.startswith(("http://", "https://"))
            else f"https://{normalized}"
        )

    @model_validator(mode="after")
    def validate_s3_settings(self) -> Self:
        missing = [
            name
            for name, value in (
                ("S3_ENDPOINT_URL", self.S3_ENDPOINT_URL),
                ("S3_BUCKET", self.S3_BUCKET),
                ("S3_ACCESS_KEY_ID", self.S3_ACCESS_KEY_ID),
                ("S3_SECRET_ACCESS_KEY", self.S3_SECRET_ACCESS_KEY),
            )
            if not value
        ]
        if missing:
            raise ValueError("Missing required S3 storage settings: " + ", ".join(missing))
        return self
