"""Only the local OCR model paths required by the subprocess."""

from pydantic_settings import BaseSettings, SettingsConfigDict
from app.platform.config.ocr import PaddleOcrConfig


class PaddleOcrSettings(PaddleOcrConfig, BaseSettings):
    model_config = SettingsConfigDict(case_sensitive=True, extra="ignore")
