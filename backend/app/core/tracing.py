"""OpenTelemetry tracing setup for the API runtime."""

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from app.core.config import settings
from app.core.logger import logger


def configure_api_tracing(app: FastAPI) -> None:
    """Configure FastAPI request tracing when explicitly enabled."""

    if not settings.OTEL_TRACING_ENABLED:
        return

    endpoint = settings.OTEL_EXPORTER_OTLP_ENDPOINT
    service_name = settings.OTEL_SERVICE_NAME
    if endpoint is None or service_name is None:
        raise RuntimeError("OpenTelemetry tracing is enabled but not configured")

    provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": service_name,
                "service.namespace": "noteverse",
            }
        )
    )
    provider.add_span_processor(
        BatchSpanProcessor(
            OTLPSpanExporter(
                endpoint=endpoint,
                insecure=settings.OTEL_EXPORTER_OTLP_INSECURE,
            )
        )
    )
    trace.set_tracer_provider(provider)

    FastAPIInstrumentor.instrument_app(app, tracer_provider=provider)
    logger.info("observability.tracing.enabled")
