"""Worker model, OMR, rendering, and playback runtime settings."""

from __future__ import annotations

from pathlib import Path
from typing import Optional, Self

from pydantic import BaseModel, field_validator, model_validator


class WorkerModelEngineSettings(BaseModel):
    """Deployment-specific dependencies required by Worker processing engines."""

    MODEL_ROOT: Optional[str] = None
    HF_HOME: Optional[str] = None
    HF_HUB_OFFLINE: bool = False
    TRANSFORMERS_OFFLINE: bool = False
    PADDLEOCR_MODEL_ROOT: Optional[str] = None
    PADDLEOCR_DETECTION_MODEL_DIR: Optional[str] = None
    PADDLEOCR_RECOGNITION_MODEL_DIR: Optional[str] = None
    PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR: Optional[str] = None
    PADDLEOCR_TIMEOUT_SECONDS: int = 300
    LEGATO_REPO_PATH: Optional[str] = None
    LEGATO_PYTHON: str = "python3"
    LEGATO_DEVICE: str = "cuda"
    LEGATO_FP16: bool = True
    LEGATO_BEAM_SIZE: int = 10
    LEGATO_BATCH_SIZE: int = 1
    LEGATO_TIMEOUT_SECONDS: int = 600

    @field_validator(
        "MODEL_ROOT",
        "HF_HOME",
        "PADDLEOCR_MODEL_ROOT",
        "PADDLEOCR_DETECTION_MODEL_DIR",
        "PADDLEOCR_RECOGNITION_MODEL_DIR",
        "PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR",
    )
    @classmethod
    def normalize_path(cls, value: Optional[str]) -> Optional[str]:
        if not value:
            return None
        return str(Path(value).expanduser())

    @field_validator("PADDLEOCR_TIMEOUT_SECONDS")
    @classmethod
    def validate_positive_runtime_limit(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("task timing settings must be positive integers")
        return value

    @model_validator(mode="after")
    def validate_omr_engine_settings(self) -> Self:
        if not self.LEGATO_REPO_PATH:
            raise ValueError("LEGATO_REPO_PATH is required for the supported LEGATO engine")
        return self
