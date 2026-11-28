"""Browser clients retain admission middleware and isolate real Redis counters per test."""

import os
from uuid import uuid4
from fastapi import Request
from fastapi.testclient import TestClient as StarletteTestClient
from redis import Redis
from app.platform.security.rate_limit import RedisSlidingWindowLimiter
from app.runtime.browser_security import get_rate_limiter

_namespace = uuid4().hex
_limiters: dict[str, RedisSlidingWindowLimiter] = {}


def test_rate_limiter(request: Request) -> RedisSlidingWindowLimiter:
    surface = type(request.app.state.settings).__name__
    if surface not in _limiters:
        client = Redis.from_url(
            os.environ.get("NOTEVERSE_TEST_REDIS_URL", os.environ["REDIS_URL"]),
            socket_timeout=1,
            socket_connect_timeout=1,
        )
        _limiters[surface] = RedisSlidingWindowLimiter(
            client, namespace=f"test-browser:{_namespace}:{surface}"
        )
    return _limiters[surface]


def reset_rate_windows() -> None:
    global _namespace
    for limiter in _limiters.values():
        for key in limiter.client.scan_iter(match=limiter.namespace + ":*"):
            limiter.client.delete(key)
        limiter.client.close()
    _limiters.clear()
    _namespace = uuid4().hex


class BrowserTestClient(StarletteTestClient):
    def __init__(self, app, *args, **kwargs):
        headers = {"Origin": kwargs.get("base_url", "http://testserver").rstrip("/")}
        headers.update(kwargs.pop("headers", {}) or {})
        self._application = app
        app.dependency_overrides.setdefault(get_rate_limiter, test_rate_limiter)
        super().__init__(app, *args, headers=headers, **kwargs)

    def request(self, *args, **kwargs):
        # Domain fixtures can clear unrelated dependency overrides between requests.
        self._application.dependency_overrides.setdefault(get_rate_limiter, test_rate_limiter)
        return super().request(*args, **kwargs)
