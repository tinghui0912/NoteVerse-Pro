"""OpenTelemetry support for durable background-operation attempts.

The worker restores only vetted W3C fields from the durable operation record.
It never trusts task arguments or broker metadata as trace context.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from opentelemetry import propagate, trace
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor
from opentelemetry.trace import SpanKind

from app.core.async_trace_context import normalize_async_trace_context
from app.core.config import settings
from app.core.logger import set_otel_trace_context


_configured = False


def configure_background_tracing(*, service_name: str | None = None) -> None:
    """Configure a worker-local tracer provider when tracing is enabled."""

    global _configured
    if _configured or not settings.OTEL_TRACING_ENABLED:
        return

    endpoint = settings.OTEL_EXPORTER_OTLP_ENDPOINT
    configured_service_name = service_name or settings.OTEL_SERVICE_NAME
    if endpoint is None or configured_service_name is None:
        raise RuntimeError("OpenTelemetry tracing is enabled but not configured")

    provider = TracerProvider(
        resource=Resource.create(
            {
                "service.name": configured_service_name,
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
    _configured = True


@contextmanager
def background_attempt_span(
    *,
    name: str,
    traceparent: str | None,
    tracestate: str | None,
    attributes: dict[str, str | int],
    kind: SpanKind = SpanKind.CONSUMER,
) -> Iterator[None]:
    """Restore durable parent context and scope one relay or worker attempt."""

    traceparent, tracestate = normalize_async_trace_context(
        traceparent=traceparent,
        tracestate=tracestate,
    )
    carrier: dict[str, str] = {}
    if traceparent is not None:
        carrier["traceparent"] = traceparent
    if tracestate is not None:
        carrier["tracestate"] = tracestate
    parent_context = propagate.extract(carrier) if carrier else None

    tracer = trace.get_tracer("noteverse.background")
    with tracer.start_as_current_span(
        name,
        context=parent_context,
        kind=kind,
        attributes=attributes,
    ) as span:
        context = span.get_span_context()
        if context.is_valid:
            set_otel_trace_context(
                {"trace_id": f"{context.trace_id:032x}", "span_id": f"{context.span_id:016x}"}
            )
        try:
            yield
        except Exception as exc:
            span.record_exception(exc)
            span.set_status(trace.Status(trace.StatusCode.ERROR, type(exc).__name__))
            raise
        finally:
            set_otel_trace_context()


def record_current_attempt_failure(exc: Exception) -> None:
    """Mark a handled business failure on the current background span."""

    span = trace.get_current_span()
    if span.is_recording():
        span.record_exception(exc)
        span.set_status(trace.Status(trace.StatusCode.ERROR, type(exc).__name__))
