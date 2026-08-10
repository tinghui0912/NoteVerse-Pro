"""Observability settings shared by backend runtimes."""

from __future__ import annotations

from typing import Optional, Self

from pydantic import BaseModel, field_validator, model_validator


class ObservabilitySettings(BaseModel):
    LOG_FORMAT: str
    OTEL_TRACING_ENABLED: bool = False
    OTEL_SERVICE_NAME: Optional[str] = None
    OTEL_EXPORTER_OTLP_ENDPOINT: Optional[str] = None
    OTEL_EXPORTER_OTLP_INSECURE: bool = True

    @field_validator("LOG_FORMAT")
    @classmethod
    def validate_log_format(cls, value: str) -> str:
        """Validate the stdout log encoding used by container log collectors."""
        normalized = value.strip().lower()
        if normalized not in {"json", "console"}:
            raise ValueError("LOG_FORMAT must be one of: json, console")
        return normalized

    @field_validator("OTEL_EXPORTER_OTLP_ENDPOINT")
    @classmethod
    def normalize_optional_otel_endpoint(cls, value: Optional[str]) -> Optional[str]:
        """Normalize the optional OTLP endpoint."""
        if not value:
            return None
        return value.strip().rstrip("/")

    @model_validator(mode="after")
    def validate_tracing_settings(self) -> Self:
        """Require exporter settings whenever tracing is enabled."""
        if self.OTEL_TRACING_ENABLED:
            missing = [
                name
                for name, value in (
                    ("OTEL_SERVICE_NAME", self.OTEL_SERVICE_NAME),
                    ("OTEL_EXPORTER_OTLP_ENDPOINT", self.OTEL_EXPORTER_OTLP_ENDPOINT),
                )
                if not value
            ]
            if missing:
                raise ValueError(
                    "Missing required OpenTelemetry settings: " + ", ".join(missing)
                )
        return self
