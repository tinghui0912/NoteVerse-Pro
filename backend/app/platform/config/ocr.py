"""Model paths for one PaddleOCR engine process."""

from pathlib import Path
from pydantic import BaseModel, field_validator


class PaddleOcrConfig(BaseModel):
    PADDLEOCR_DETECTION_MODEL_DIR: str
    PADDLEOCR_RECOGNITION_MODEL_DIR: str
    PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR: str

    @field_validator(
        "PADDLEOCR_DETECTION_MODEL_DIR",
        "PADDLEOCR_RECOGNITION_MODEL_DIR",
        "PADDLEOCR_TEXTLINE_ORIENTATION_MODEL_DIR",
    )
    @classmethod
    def normalize_model_path(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("OCR model path is required")
        return str(Path(value).expanduser().absolute())
