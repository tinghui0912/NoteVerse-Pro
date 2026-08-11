from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import pytest
from opentelemetry.sdk.trace import TracerProvider
from opentelemetry.sdk.trace.export import SimpleSpanProcessor
from opentelemetry.sdk.trace.export.in_memory_span_exporter import InMemorySpanExporter
from opentelemetry.trace import SpanKind

from app.core import background_tracing
from app.core.logger import get_otel_trace_context, set_otel_trace_context
from app.worker import celery_config
from app.worker.dispatch import import_jobs
from app.worker.dispatch import runtime as dispatch_runtime
from app.worker.dispatch.tracing import DurableTraceContext


TRACEPARENT = "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01"


def _install_in_memory_tracer(
    monkeypatch: pytest.MonkeyPatch,
) -> InMemorySpanExporter:
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("noteverse.background")
    monkeypatch.setattr(background_tracing.trace, "get_tracer", lambda _name: tracer)
    return exporter


def test_attempt_spans_restore_the_same_durable_parent_for_each_retry(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    exporter = _install_in_memory_tracer(monkeypatch)

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

    spans = exporter.get_finished_spans()
    assert len(spans) == 2
    assert len({span.context.span_id for span in spans}) == 2
    assert {span.context.trace_id for span in spans} == {int("0123456789abcdef0123456789abcdef", 16)}
    assert {span.parent.span_id for span in spans if span.parent is not None} == {
        int("0123456789abcdef", 16)
    }
    assert [span.attributes["noteverse.operation.attempt"] for span in spans] == [1, 2]
    assert all(span.kind == SpanKind.CONSUMER for span in spans)


def test_invalid_durable_context_creates_an_independent_attempt_root(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    exporter = _install_in_memory_tracer(monkeypatch)

    with background_tracing.background_attempt_span(
        name="noteverse.render.generate",
        traceparent="invalid",
        tracestate=None,
        attributes={"noteverse.operation.kind": "render", "noteverse.operation.id": "outbox-1"},
    ):
        pass

    span = exporter.get_finished_spans()[0]
    assert span.parent is None


def test_background_spans_restore_the_outer_log_context(monkeypatch: pytest.MonkeyPatch) -> None:
    exporter = _install_in_memory_tracer(monkeypatch)
    outer_context = {"trace_id": "outer-trace", "span_id": "outer-span"}
    set_otel_trace_context(outer_context)

    with background_tracing.background_root_span(
        name="noteverse.scheduler.scan",
        attributes={"noteverse.operation.kind": "scheduler"},
    ):
        current_context = get_otel_trace_context()
        assert current_context["trace_id"] != outer_context["trace_id"]
        assert current_context["span_id"] != outer_context["span_id"]

    assert exporter.get_finished_spans()[0].parent is None
    assert get_otel_trace_context() == outer_context
    set_otel_trace_context()


def test_idle_scheduler_spans_are_not_exported_or_linked_from_logs(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(
        background_tracing._SchedulerActivitySpanProcessor(SimpleSpanProcessor(exporter))
    )
    tracer = provider.get_tracer("noteverse.background")
    monkeypatch.setattr(background_tracing.trace, "get_tracer", lambda _name: tracer)

    with background_tracing.background_root_span(
        name="noteverse.scheduler.scan",
        attributes={"noteverse.operation.kind": "scheduler"},
    ):
        assert get_otel_trace_context()
        background_tracing.set_scheduler_trace_outcome(
            has_activity=False,
            due=0,
            dispatched=0,
        )
        assert get_otel_trace_context() == {}

    assert exporter.get_finished_spans() == ()


def test_relay_dispatch_log_is_emitted_inside_its_producer_span(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    exporter = _install_in_memory_tracer(monkeypatch)
    log_contexts: list[dict[str, str]] = []

    @contextmanager
    def fake_db() -> Iterator[object]:
        yield object()

    class CapturingLogger:
        def bind(self, **_context: object) -> CapturingLogger:
            return self

        def info(self, _message: str) -> None:
            log_contexts.append(get_otel_trace_context())

    monkeypatch.setattr(import_jobs, "get_worker_db", fake_db)
    monkeypatch.setattr(
        import_jobs,
        "import_trace_context",
        lambda _db, _job_uuid: DurableTraceContext(traceparent=TRACEPARENT, tracestate=None),
    )
    monkeypatch.setattr(dispatch_runtime.celery_app, "send_task", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(dispatch_runtime, "logger", CapturingLogger())

    assert import_jobs.dispatch_import_job("job-1")

    assert len(log_contexts) == 1
    assert log_contexts[0]["trace_id"] == "0123456789abcdef0123456789abcdef"
    assert len(log_contexts[0]["span_id"]) == 16
    spans = exporter.get_finished_spans()
    assert len(spans) == 1
    assert spans[0].kind == SpanKind.PRODUCER


def test_celery_worker_process_initialization_configures_background_tracing(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    configured: list[bool] = []
    monkeypatch.setattr(
        background_tracing,
        "configure_background_tracing",
        lambda: configured.append(True),
    )

    celery_config.setup_worker_tracing()

    assert configured == [True]
