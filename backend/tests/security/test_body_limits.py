"""Ingress byte accounting remains active before framework body parsing."""

import json
import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient
from starlette.responses import JSONResponse, Response
from app.platform.security.body_limit import RequestBodyLimit, PathBodyLimitRule
from app.runtime.customer_api.main import create_app
from app.runtime.control_plane.main import create_app as create_control_app


async def invoke(app, *, path="/json", headers=(), chunks=(b"1234",)):
    consumed = []
    messages = []
    source = iter(chunks)

    async def receive():
        chunk = next(source)
        consumed.append(chunk)
        return {"type": "http.request", "body": chunk, "more_body": True}

    async def send(message):
        messages.append(message)

    await app(
        {
            "type": "http",
            "method": "POST",
            "path": path,
            "headers": list(headers),
            "query_string": b"",
            "scheme": "http",
            "server": ("testserver", 80),
            "http_version": "1.1",
            "state": {"request_id": "a" * 32},
        },
        receive,
        send,
    )
    return messages, consumed


def guard(downstream, *, default=4, rules=()):
    return RequestBodyLimit(
        downstream,
        default_max_bytes=default,
        path_limits=rules,
        error_response=lambda scope, status: JSONResponse(
            {"code": "payload_too_large" if status == 413 else "validation_error"},
            status_code=status,
        ),
    )


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "length,status",
    [(b"5", 413), (b"-1", 400), (b"x", 400), (b"1.0", 400), (b"", 400), (b"9" * 21, 400)],
)
async def test_declared_length_rejects_without_reading_or_entering_app(length, status):
    async def downstream(*args):
        pytest.fail("Oversized or malformed declarations cannot reach the app")

    messages, consumed = await invoke(guard(downstream), headers=[(b"content-length", length)])
    assert messages[0]["status"] == status
    assert consumed == []


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "headers",
    [
        [],
        [(b"transfer-encoding", b"chunked")],
        [(b"content-length", b"1")],
        [(b"content-length", b"0")],
    ],
)
async def test_actual_stream_stops_at_first_excess_chunk(headers):
    buffered = []

    async def downstream(scope, receive, send):
        while True:
            buffered.append((await receive())["body"])

    messages, consumed = await invoke(
        guard(downstream), headers=headers, chunks=(b"123", b"45", b"unread")
    )
    assert messages[0]["status"] == 413
    assert consumed == [b"123", b"45"]
    assert buffered == [b"123"]


@pytest.mark.asyncio
async def test_duplicate_content_lengths_fail_closed():
    messages, consumed = await invoke(
        guard(None), headers=[(b"content-length", b"2"), (b"content-length", b"2")]
    )
    assert messages[0]["status"] == 400
    assert not consumed


@pytest.mark.asyncio
async def test_framework_error_cannot_turn_stream_rejection_into_bad_json():
    app = FastAPI()

    @app.post("/json")
    async def route(request: Request):
        await request.json()
        pytest.fail("The route cannot parse an oversized document")

    messages, _ = await invoke(guard(app), chunks=(b'{"a', b'":"large"}', b"unread"))
    assert messages[0]["status"] == 413
    assert len([m for m in messages if m["type"] == "http.response.start"]) == 1


@pytest.mark.parametrize(
    "factory,limit", [(create_app, 2 * 1024 * 1024), (create_control_app, 512 * 1024)]
)
def test_runtime_defaults_count_chunked_bodies(factory, limit):
    app = factory()

    @app.post("/body-probe")
    async def probe(request: Request):
        return Response(await request.body())

    with TestClient(app) as client:
        response = client.post(
            "/body-probe",
            content=iter([b"x" * limit, b"!"]),
            headers={"origin": "http://testserver", "content-type": "application/json"},
        )
    assert response.status_code == 413
    assert response.json()["code"] == "payload_too_large"


@pytest.mark.parametrize(
    "path,limit",
    [
        ("/api/v1/me/avatar", 6 * 1024 * 1024),
        ("/api/v1/scores/score/revisions", 32 * 1024 * 1024),
        ("/api/v1/scores/score/fingering", 32 * 1024 * 1024),
        ("/api/v1/import-jobs/job/review", 32 * 1024 * 1024),
        ("/api/v1/import-jobs/job/review/confirm", 32 * 1024 * 1024),
        ("/api/v1/playback/performance-plan", 32 * 1024 * 1024),
    ],
)
@pytest.mark.asyncio
async def test_runtime_exact_path_budgets(path, limit):
    middleware = next(m for m in create_app().user_middleware if m.cls is RequestBodyLimit)
    completed = []

    async def reader(scope, receive, send):
        total = 0
        while total < limit:
            total += len((await receive())["body"])
        completed.append(total)
        await send({"type": "http.response.start", "status": 204, "headers": []})
        await send({"type": "http.response.body", "body": b""})

    app = RequestBodyLimit(reader, **middleware.kwargs)
    messages, _ = await invoke(app, path=path, chunks=(b"x" * limit,))
    assert messages[0]["status"] == 204
    assert completed == [limit]
    messages, consumed = await invoke(
        app, path=path, headers=[(b"content-length", str(limit + 1).encode())]
    )
    assert messages[0]["status"] == 413
    assert not consumed


@pytest.mark.asyncio
async def test_avatar_chunked_over_cap_stops_before_multipart_parser():
    middleware = next(m for m in create_app().user_middleware if m.cls is RequestBodyLimit)
    forwarded = []

    async def multipart(scope, receive, send):
        while True:
            forwarded.append((await receive())["body"])

    app = RequestBodyLimit(multipart, **middleware.kwargs)
    messages, consumed = await invoke(
        app,
        path="/api/v1/me/avatar",
        headers=[
            (b"transfer-encoding", b"chunked"),
            (b"content-type", b"multipart/form-data; boundary=test"),
        ],
        chunks=(b"x" * (6 * 1024 * 1024), b"!", b"unread"),
    )
    assert messages[0]["status"] == 413
    assert len(consumed) == 2 and len(forwarded) == 1


def test_untrusted_xml_maps_security_and_size_to_non_500():
    from app.platform.document_admission.musicxml import MUSICXML_LIMITS

    with TestClient(create_app()) as client:
        headers = {"origin": "http://testserver"}
        malicious = '<!DOCTYPE score-partwise [<!ENTITY x SYSTEM "file:///etc/passwd">]><score-partwise>&x;</score-partwise>'
        response = client.post(
            "/api/v1/playback/performance-plan", json={"musicxml": malicious}, headers=headers
        )
        assert response.status_code == 422
        for encoding in ("u-t-f-8", "utf--8"):
            response = client.post(
                "/api/v1/playback/performance-plan",
                json={"musicxml": f'<?xml version="1.0" encoding="{encoding}"?><score-partwise/>'},
                headers=headers,
            )
            assert response.status_code == 422
        response = client.post(
            "/api/v1/playback/performance-plan",
            json={"musicxml": "x" * (MUSICXML_LIMITS.max_bytes + 1)},
            headers=headers,
        )
        assert response.status_code == 413
        assert response.json()["code"] == "payload_too_large"
        # Multi-byte text crosses the byte budget while remaining below the character cap.
        content = (
            "<score-partwise>" + ("中" * (MUSICXML_LIMITS.max_bytes // 3)) + "</score-partwise>"
        )
        response = client.post(
            "/api/v1/playback/performance-plan",
            content=json.dumps({"musicxml": content}, ensure_ascii=False).encode(),
            headers={**headers, "content-type": "application/json"},
        )
        assert response.status_code == 413
        assert response.json()["code"] == "payload_too_large"


def test_path_rules_are_segment_bounded_and_validated():
    assert PathBodyLimitRule("/docs", 8, "prefix").matches("/docs/a")
    assert not PathBodyLimitRule("/docs", 8, "prefix").matches("/docstrings")
    for args in [("relative", 8), ("/x", 0), ("/x", 1, "other")]:
        with pytest.raises(ValueError):
            PathBodyLimitRule(*args)
