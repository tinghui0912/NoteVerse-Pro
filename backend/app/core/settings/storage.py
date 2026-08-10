"""Durable object storage and local runtime-directory settings."""

from __future__ import annotations

import os
from pathlib import Path
from typing import Optional, Self

from pydantic import BaseModel, field_validator, model_validator


class StorageSettings(BaseModel):
    FILE_STORAGE_BACKEND: str = "local"
    S3_ENDPOINT_URL: Optional[str] = None
    S3_REGION: str = "auto"
    S3_BUCKET: Optional[str] = None
    S3_ACCESS_KEY_ID: Optional[str] = None
    S3_SECRET_ACCESS_KEY: Optional[str] = None
    S3_PUBLIC_BASE_URL: Optional[str] = None
    S3_FORCE_PATH_STYLE: bool = True
    S3_PRESIGN_EXPIRE_SECONDS: int = 900
    STORAGE_ROOT: str = "data/storage"
    WORK_ROOT: str = "data/work"

    @field_validator("STORAGE_ROOT", "WORK_ROOT")
    @classmethod
    def resolve_runtime_folders(cls, value: str) -> str:
        path = Path(value)
        if not os.path.isabs(value):
            path = (Path(__file__).resolve().parents[3] / path).resolve()
        if path.exists() and not path.is_dir():
            raise ValueError(f"{value} exists but is not a directory")
        return str(path)

    @field_validator("FILE_STORAGE_BACKEND")
    @classmethod
    def validate_file_storage_backend(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"local", "s3"}:
            raise ValueError("FILE_STORAGE_BACKEND must be one of: local, s3")
        return normalized

    @field_validator("S3_ENDPOINT_URL", "S3_PUBLIC_BASE_URL")
    @classmethod
    def normalize_optional_url(cls, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        normalized = value.strip().rstrip("/")
        return normalized if normalized.startswith(("http://", "https://")) else f"https://{normalized}"

    @model_validator(mode="after")
    def validate_s3_settings(self) -> Self:
        if self.FILE_STORAGE_BACKEND == "s3":
            missing = [
                name for name, value in (
                    ("S3_ENDPOINT_URL", self.S3_ENDPOINT_URL), ("S3_BUCKET", self.S3_BUCKET),
                    ("S3_ACCESS_KEY_ID", self.S3_ACCESS_KEY_ID), ("S3_SECRET_ACCESS_KEY", self.S3_SECRET_ACCESS_KEY),
                ) if not value
            ]
            if missing:
                raise ValueError("Missing required S3 storage settings: " + ", ".join(missing))
        return self
