"""Transport peer and configured proxy suffix determine the security identity."""

import pytest
from app.platform.security.client_ip import client_ip


@pytest.mark.parametrize(
    "peer,hops,forwarded,expected",
    [
        ("10.1.2.3", 0, "198.51.100.42", "10.1.2.3"),
        ("203.0.113.1", 1, "198.51.100.42", "203.0.113.1"),
        ("10.1.2.3", 1, "spoofed, 198.51.100.42", "198.51.100.42"),
        ("10.1.2.3", 2, "203.0.113.9, 198.51.100.42, 10.2.3.4", "198.51.100.42"),
        ("10.1.2.3", 2, "198.51.100.42, 203.0.113.9", "10.1.2.3"),
        ("10.1.2.3", 2, "198.51.100.42", "10.1.2.3"),
        ("10.1.2.3", 1, "unknown", "10.1.2.3"),
        ("10.1.2.3", 1, "", "10.1.2.3"),
        ("10.1.2.3", 1, "2001:db8::42", "2001:db8::42"),
    ],
)
def test_explicit_proxy_suffix(peer, hops, forwarded, expected):
    scope = {
        "type": "http",
        "client": (peer, 123),
        "headers": [(b"x-forwarded-for", forwarded.encode())],
    }
    assert client_ip(scope, trusted_proxy_hops=hops, trusted_proxy_cidrs=["10.0.0.0/8"]) == expected


def test_ambiguous_duplicate_headers_and_forwarded_do_not_override_peer():
    scope = {
        "type": "http",
        "client": ("10.1.2.3", 123),
        "headers": [(b"forwarded", b"for=198.51.100.42")],
    }
    assert client_ip(scope, trusted_proxy_hops=1, trusted_proxy_cidrs=["10.0.0.0/8"]) == "10.1.2.3"
    scope["headers"] = [(b"x-forwarded-for", b"198.51.100.42")] * 2
    assert client_ip(scope, trusted_proxy_hops=1, trusted_proxy_cidrs=["10.0.0.0/8"]) == "10.1.2.3"
