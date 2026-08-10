"""Worker model, OMR, rendering, and playback runtime settings."""

from __future__ import annotations

import json
from pathlib import Path
from typing import List, Optional, Self

from pydantic import BaseModel, field_validator, model_validator


class WorkerModelEngineSettings(BaseModel):
    """Deployment-specific dependencies required by Worker processing engines."""

    PLAYBACK_SOUNDFONT_PATH: str
    PLAYBACK_SAMPLE_RATE: int = 44100
    PLAYBACK_MAX_DURATION_SECONDS: float = 180.0
    MODEL_ROOT: Optional[str] = None
    HF_HOME: Optional[str] = None
    HF_MODEL_REPOSITORIES: List[str]
    HF_HUB_OFFLINE: bool = False
    TRANSFORMERS_OFFLINE: bool = False
    PADDLEOCR_MODEL_ROOT: Optional[str] = None
    PADDLEOCR_DETECTION_MODEL_DIR: Optional[str] = None
    PADDLEOCR_RECOGNITION_MODEL_DIR: Optional[str] = None
    PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR: Optional[str] = None
    PADDLEOCR_TIMEOUT_SECONDS: int = 300
    OMR_ENGINE: str = "legato"
    LEGATO_REPO_PATH: Optional[str] = None
    LEGATO_REPO_COMMIT: Optional[str] = "179c228d3d5f67113cf739b44891b3abe046f1dc"
    LEGATO_PYTHON: str = "python3"
    LEGATO_MODEL_PATH: str = "guangyangmusic/legato"
    LEGATO_PROCESSOR_PATH: Optional[str] = None
    LEGATO_DEVICE: str = "cuda"
    LEGATO_FP16: bool = True
    LEGATO_BEAM_SIZE: int = 10
    LEGATO_BATCH_SIZE: int = 1
    LEGATO_TIMEOUT_SECONDS: int = 600
    SCORE_RENDER_ENGINE: str = "verovio"
    VEROVIO_PAGE_WIDTH: int = 2100
    VEROVIO_PAGE_HEIGHT: int = 2970
    VEROVIO_SCALE: int = 40
    VEROVIO_BREAKS: str = "encoded"
    VEROVIO_ADJUST_PAGE_HEIGHT: bool = False
    VEROVIO_JUSTIFY_VERTICALLY: bool = True
    VEROVIO_PAGE_MARGIN_TOP: int = 390
    VEROVIO_PAGE_MARGIN_BOTTOM: int = 80
    VEROVIO_HEADER: str = "none"
    VEROVIO_FOOTER: str = "always"
    VEROVIO_USE_PG_FOOTER_FOR_ALL: bool = True
    VEROVIO_PREVIEW_HEADER_POSTPROCESSING: bool = True

    @field_validator("HF_MODEL_REPOSITORIES", mode="before")
    @classmethod
    def parse_hf_model_repositories(cls, value: str | List[str]) -> List[str]:
        """Parse the explicit Hugging Face snapshot list required by Workers."""

        if isinstance(value, list):
            return value
        if isinstance(value, str):
            normalized = value.strip()
            if not normalized:
                raise ValueError("HF_MODEL_REPOSITORIES must not be empty")
            if normalized.startswith("["):
                parsed = json.loads(normalized)
                if not isinstance(parsed, list):
                    raise ValueError("HF_MODEL_REPOSITORIES must be a JSON array or comma-separated list")
                return parsed
            return [item.strip() for item in normalized.split(",") if item.strip()]
        raise ValueError("HF_MODEL_REPOSITORIES must be a JSON array or comma-separated list")

    @field_validator(
        "PLAYBACK_SOUNDFONT_PATH",
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

    @field_validator("PLAYBACK_SAMPLE_RATE", "PADDLEOCR_TIMEOUT_SECONDS")
    @classmethod
    def validate_positive_runtime_limit(cls, value: int) -> int:
        if value <= 0:
            raise ValueError("task timing settings must be positive integers")
        return value

    @field_validator("PLAYBACK_MAX_DURATION_SECONDS")
    @classmethod
    def validate_playback_max_duration(cls, value: float) -> float:
        if value <= 0:
            raise ValueError("PLAYBACK_MAX_DURATION_SECONDS must be positive")
        return value

    @field_validator("OMR_ENGINE")
    @classmethod
    def validate_omr_engine(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized != "legato":
            raise ValueError("OMR_ENGINE must be: legato")
        return normalized

    @field_validator("SCORE_RENDER_ENGINE")
    @classmethod
    def validate_score_render_engine(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized != "verovio":
            raise ValueError("SCORE_RENDER_ENGINE must be: verovio")
        return normalized

    @field_validator("VEROVIO_HEADER")
    @classmethod
    def validate_verovio_header(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"none", "auto", "encoded"}:
            raise ValueError("VEROVIO_HEADER must be one of: none, auto, encoded")
        return normalized

    @field_validator("VEROVIO_FOOTER")
    @classmethod
    def validate_verovio_footer(cls, value: str) -> str:
        normalized = value.strip().lower()
        if normalized not in {"none", "auto", "encoded", "always"}:
            raise ValueError("VEROVIO_FOOTER must be one of: none, auto, encoded, always")
        return normalized

    @model_validator(mode="after")
    def validate_omr_engine_settings(self) -> Self:
        if self.OMR_ENGINE == "legato" and not self.LEGATO_REPO_PATH:
            raise ValueError("LEGATO_REPO_PATH is required when OMR_ENGINE=legato")
        return self
