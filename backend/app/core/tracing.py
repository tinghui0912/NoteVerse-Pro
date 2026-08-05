"""OpenTelemetry tracing setup for the API runtime."""

from fastapi import FastAPI
from opentelemetry import trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor

from app.core.config import settings
from app.core.logger import logger, set_otel_trace_context


EXCLUDED_TRACE_URLS = "/health/live,/health/ready,/metrics"


def capture_current_trace_context() -> None:
    """Copy the active W3C span context into the shared log context."""

    context = trace.get_current_span().get_span_context()
    if not context.is_valid:
        set_otel_trace_context()
        return
    set_otel_trace_context(
        {
            "trace_id": f"{context.trace_id:032x}",
            "span_id": f"{context.span_id:016x}",
        }
    )


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

    FastAPIInstrumentor.instrument_app(
        app,
        tracer_provider=provider,
        excluded_urls=EXCLUDED_TRACE_URLS,
    )
    logger.info("observability.tracing.enabled")
