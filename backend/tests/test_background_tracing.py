from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from opentelemetry import trace
from opentelemetry.trace import SpanKind

from app.core import background_tracing
from app.worker import celery_config


TRACEPARENT = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"


class _FakeSpan:
    def get_span_context(self) -> trace.SpanContext:
        return trace.INVALID_SPAN_CONTEXT

    def record_exception(self, _exception: Exception) -> None:
        return None

    def set_status(self, _status: trace.Status) -> None:
        return None


class _FakeTracer:
    def __init__(self) -> None:
        self.calls: list[dict[str, Any]] = []

    @contextmanager
    def start_as_current_span(self, name: str, **kwargs: Any) -> Iterator[_FakeSpan]:
        self.calls.append({"name": name, **kwargs})
        yield _FakeSpan()


def test_attempt_spans_restore_the_same_durable_parent_for_each_retry(
    monkeypatch: Any,
) -> None:
    tracer = _FakeTracer()
    monkeypatch.setattr(background_tracing.trace, "get_tracer", lambda _name: tracer)

    for attempt in (1, 2):
        with background_tracing.background_attempt_span(
            name="noteverse.import.process",
            traceparent=TRACEPARENT,
            tracestate=None,
            kind=SpanKind.CONSUMER,
            attributes={
                "noteverse.operation.kind": "import",
                "noteverse.operation.id": "job-1",
                "noteverse.operation.attempt": attempt,
            },
        ):
            pass

    assert len(tracer.calls) == 2
    assert [call["attributes"]["noteverse.operation.attempt"] for call in tracer.calls] == [1, 2]
    assert all(call["kind"] == SpanKind.CONSUMER for call in tracer.calls)

    parent_trace_ids = [
        trace.get_current_span(call["context"]).get_span_context().trace_id
        for call in tracer.calls
    ]
    assert parent_trace_ids == [int("0123456789abcdef0123456789abcdef", 16)] * 2


def test_invalid_durable_context_creates_an_independent_attempt_root(
    monkeypatch: Any,
) -> None:
    tracer = _FakeTracer()
    monkeypatch.setattr(background_tracing.trace, "get_tracer", lambda _name: tracer)

    with background_tracing.background_attempt_span(
        name="noteverse.render.generate",
        traceparent="invalid",
        tracestate=None,
        attributes={"noteverse.operation.kind": "render", "noteverse.operation.id": "outbox-1"},
    ):
        pass

    assert tracer.calls[0]["context"] is None


def test_scheduled_work_uses_an_independent_root_span(monkeypatch: Any) -> None:
    tracer = _FakeTracer()
    monkeypatch.setattr(background_tracing.trace, "get_tracer", lambda _name: tracer)

    with background_tracing.background_root_span(
        name="noteverse.scheduler.scan",
        attributes={
            "noteverse.operation.kind": "scheduler",
            "noteverse.scheduler.job": "render_outbox",
        },
    ):
        pass

    assert tracer.calls == [
        {
            "name": "noteverse.scheduler.scan",
            "context": None,
            "kind": SpanKind.INTERNAL,
            "attributes": {
                "noteverse.operation.kind": "scheduler",
                "noteverse.scheduler.job": "render_outbox",
            },
        }
    ]


def test_celery_worker_process_initialization_configures_background_tracing(
    monkeypatch: Any,
) -> None:
    configured: list[bool] = []
    monkeypatch.setattr(
        background_tracing,
        "configure_background_tracing",
        lambda: configured.append(True),
    )

    celery_config.setup_worker_tracing()

    assert configured == [True]
