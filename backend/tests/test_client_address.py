from __future__ import annotations

from starlette.requests import Request

from app.core.client_address import client_address, peer_address
from app.core.config import settings


def _request(*, peer: str, headers: dict[str, str] | None = None) -> Request:
    encoded_headers = [
        (key.lower().encode("latin-1"), value.encode("latin-1"))
        for key, value in (headers or {}).items()
    ]
    return Request(
        {
            "type": "http",
            "method": "GET",
            "scheme": "https",
            "path": "/api/v1/ops/async-operations",
            "raw_path": b"/api/v1/ops/async-operations",
            "query_string": b"",
            "headers": encoded_headers,
            "client": (peer, 443),
            "server": ("api.noteverse.test", 443),
        }
    )


def test_client_address_ignores_forwarded_headers_from_untrusted_peers(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TRUSTED_PROXY_CIDRS", ["10.0.0.0/8"])
    request = _request(
        peer="203.0.113.14",
        headers={"X-Forwarded-For": "198.51.100.42"},
    )

    assert peer_address(request) == "203.0.113.14"
    assert client_address(request) == "203.0.113.14"


def test_client_address_uses_x_forwarded_for_only_from_trusted_proxy(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TRUSTED_PROXY_CIDRS", ["10.0.0.0/8"])
    request = _request(
        peer="10.1.2.3",
        headers={"X-Forwarded-For": "198.51.100.42, 10.1.2.4"},
    )

    assert client_address(request) == "198.51.100.42"


def test_client_address_prefers_standard_forwarded_header(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TRUSTED_PROXY_CIDRS", ["10.0.0.0/8"])
    request = _request(
        peer="10.1.2.3",
        headers={
            "Forwarded": "for=198.51.100.42;proto=https, for=10.1.2.4",
            "X-Forwarded-For": "203.0.113.90",
        },
    )

    assert client_address(request) == "198.51.100.42"


def test_client_address_rejects_malformed_forwarded_header(monkeypatch) -> None:
    monkeypatch.setattr(settings, "TRUSTED_PROXY_CIDRS", ["10.0.0.0/8"])
    request = _request(peer="10.1.2.3", headers={"Forwarded": "for=unknown"})

    assert client_address(request) == "10.1.2.3"
