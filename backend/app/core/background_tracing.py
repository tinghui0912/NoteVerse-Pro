"""OpenTelemetry support for durable background-operation attempts.

The worker restores only vetted W3C fields from the durable operation record.
It never trusts task arguments or broker metadata as trace context.
"""

from collections.abc import Iterator
from contextlib import contextmanager

from opentelemetry import propagate, trace
from opentelemetry.context import Context
from opentelemetry.exporter.otlp.proto.grpc.trace_exporter import OTLPSpanExporter
from opentelemetry.sdk.resources import Resource
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import BatchSpanProcessor, ReadableSpan, SpanProcessor
from opentelemetry.trace import SpanKind

from app.core.async_trace_context import normalize_async_trace_context
from app.core.config import settings
from app.core.logger import get_otel_trace_context, set_otel_trace_context


_configured = False
_SCHEDULER_SCAN_SPAN_NAME = "noteverse.scheduler.scan"
_SCHEDULER_ACTIVITY_ATTRIBUTE = "noteverse.scheduler.activity"


class _SchedulerActivitySpanProcessor(SpanProcessor):
    """Drop completed idle scheduler scans before they leave the worker process."""

    def __init__(self, delegate: SpanProcessor) -> None:
        self._delegate = delegate

    def on_start(self, span: trace.Span, parent_context: Context | None = None) -> None:
        self._delegate.on_start(span, parent_context=parent_context)

    def on_end(self, span: ReadableSpan) -> None:
        if (
            span.name == _SCHEDULER_SCAN_SPAN_NAME
            and span.attributes.get(_SCHEDULER_ACTIVITY_ATTRIBUTE) == "idle"
        ):
            return
        self._delegate.on_end(span)

    def shutdown(self) -> None:
        self._delegate.shutdown()

    def force_flush(self, timeout_millis: int = 30_000) -> bool:
        return self._delegate.force_flush(timeout_millis=timeout_millis)


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
        _SchedulerActivitySpanProcessor(
            BatchSpanProcessor(
                OTLPSpanExporter(
                    endpoint=endpoint,
                    insecure=settings.OTEL_EXPORTER_OTLP_INSECURE,
                )
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

    with _background_span(
        name=name,
        parent_context=parent_context,
        kind=kind,
        attributes=attributes,
    ):
        yield


@contextmanager
def background_root_span(
    *,
    name: str,
    attributes: dict[str, str | int],
    kind: SpanKind = SpanKind.INTERNAL,
) -> Iterator[None]:
    """Scope scheduled or otherwise originless work under a fresh trace root."""

    with _background_span(
        name=name,
        parent_context=None,
        kind=kind,
        attributes=attributes,
    ):
        yield


@contextmanager
def _background_span(
    *,
    name: str,
    parent_context: Context | None,
    kind: SpanKind,
    attributes: dict[str, str | int],
) -> Iterator[None]:
    """Bind one background span to logging context and record handled failures."""

    previous_log_context = get_otel_trace_context()
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
            set_otel_trace_context(previous_log_context)


def set_scheduler_trace_outcome(*, has_activity: bool, due: int, dispatched: int) -> None:
    """Classify a scheduler scan before its span is exported."""

    span = trace.get_current_span()
    if not span.is_recording():
        return
    span.set_attribute(_SCHEDULER_ACTIVITY_ATTRIBUTE, "work" if has_activity else "idle")
    span.set_attribute("noteverse.scheduler.due", due)
    span.set_attribute("noteverse.scheduler.dispatched", dispatched)
    if not has_activity:
        # The processor drops this span. Do not emit Loki records that link to
        # a trace intentionally absent from Tempo.
        set_otel_trace_context()


def record_current_attempt_failure(exc: Exception) -> None:
    """Mark a handled business failure on the current background span."""

    span = trace.get_current_span()
    if span.is_recording():
        span.record_exception(exc)
        span.set_status(trace.Status(trace.StatusCode.ERROR, type(exc).__name__))
