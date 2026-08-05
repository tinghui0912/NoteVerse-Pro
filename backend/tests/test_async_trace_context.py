from app.core.async_trace_context import get_async_trace_context, set_async_trace_context
from app.db.models import ImportJob, MailOutbox, PlaybackOutbox, RenderOutbox


def test_async_trace_context_is_explicit_and_resettable() -> None:
    set_async_trace_context(
        traceparent="00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        tracestate="vendor=value",
    )
    assert get_async_trace_context() == (
        "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        "vendor=value",
    )

    set_async_trace_context(traceparent=None)
    assert get_async_trace_context() == (None, None)


def test_async_trace_context_discards_invalid_or_unsafe_values() -> None:
    set_async_trace_context(
        traceparent="00-00000000000000000000000000000000-0123456789abcdef-01",
        tracestate="vendor=value",
    )
    assert get_async_trace_context() == (None, None)

    set_async_trace_context(
        traceparent="00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        tracestate="vendor=value\nunsafe",
    )
    assert get_async_trace_context() == (
        "00-0123456789abcdef0123456789abcdef-0123456789abcdef-01",
        None,
    )


def test_durable_async_models_expose_w3c_creation_context() -> None:
    for model in (ImportJob, RenderOutbox, PlaybackOutbox, MailOutbox):
        columns = model.__table__.columns
        assert columns["traceparent"].type.length == 55
        assert columns["tracestate"].type.length == 512
