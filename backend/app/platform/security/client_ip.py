"""Client IP authority uses the transport peer and an explicit trusted proxy suffix."""

from ipaddress import ip_address, ip_network
from collections.abc import Sequence
from starlette.types import Scope


def client_ip(scope: Scope, *, trusted_proxy_hops: int, trusted_proxy_cidrs: Sequence[str]) -> str:
    peer = scope.get("client")
    fallback = peer[0] if peer else "unknown"
    if trusted_proxy_hops < 0:
        raise ValueError("Trusted proxy hops cannot be negative")
    if not trusted_proxy_hops:
        return fallback
    try:
        networks = tuple(ip_network(value, strict=False) for value in trusted_proxy_cidrs)

        def trusted(value: str) -> bool:
            return any(ip_address(value) in network for network in networks)

        if not trusted(fallback):
            return fallback
        headers = [
            value for name, value in scope.get("headers", []) if name.lower() == b"x-forwarded-for"
        ]
        if len(headers) != 1:
            return fallback
        values = headers[0].decode("ascii").split(",")
        if len(values) < trusted_proxy_hops:
            return fallback
        chain = [str(ip_address(part.strip())) for part in values[-trusted_proxy_hops:]]
        if not all(trusted(value) for value in chain[1:]):
            return fallback
        return chain[-trusted_proxy_hops]
    except (ValueError, UnicodeError):
        return fallback
