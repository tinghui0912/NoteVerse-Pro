import pytest
from pydantic import ValidationError

from app.core.settings.observability import ObservabilitySettings


def test_observability_settings_normalize_log_format_and_otlp_endpoint() -> None:
    settings = ObservabilitySettings(
        LOG_FORMAT="JSON",
        OTEL_EXPORTER_OTLP_ENDPOINT="https://otel.example/",
    )

    assert settings.LOG_FORMAT == "json"
    assert settings.OTEL_EXPORTER_OTLP_ENDPOINT == "https://otel.example"


def test_observability_settings_fail_fast_when_enabled_tracing_is_incomplete() -> None:
    with pytest.raises(ValidationError, match="Missing required OpenTelemetry settings"):
        ObservabilitySettings(LOG_FORMAT="console", OTEL_TRACING_ENABLED=True)
