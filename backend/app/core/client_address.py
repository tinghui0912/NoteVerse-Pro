"""Resolve client addresses without trusting spoofable forwarding headers."""

from __future__ import annotations

from ipaddress import IPv4Address, IPv6Address, ip_address, ip_network

from fastapi import Request

from app.core.config import settings


IPAddress = IPv4Address | IPv6Address


def peer_address(request: Request) -> str | None:
    """Return the immediate transport peer as reported by the ASGI server."""

    return request.client.host if request.client is not None else None


def client_address(request: Request) -> str | None:
    """Return the originating address only when the direct peer is trusted.

    Forwarding headers are caller-controlled until the immediate ASGI peer is a
    configured reverse proxy. When the peer is not trusted, this deliberately
    returns the transport address and ignores every forwarding header.
    """

    peer = peer_address(request)
    if peer is None or not _is_trusted_proxy(peer):
        return peer

    forwarded = request.headers.get("forwarded")
    if forwarded is not None:
        chain = _forwarded_for_chain(forwarded)
        return _resolve_forwarded_chain(chain, fallback=peer) if chain is not None else peer

    x_forwarded_for = request.headers.get("x-forwarded-for")
    if x_forwarded_for is not None:
        chain = _x_forwarded_for_chain(x_forwarded_for)
        if chain is not None:
            return _resolve_forwarded_chain(chain, fallback=peer)

    return peer


def _is_trusted_proxy(value: str) -> bool:
    parsed = _parse_ip(value)
    if parsed is None:
        return False
    return any(parsed in ip_network(network, strict=False) for network in settings.TRUSTED_PROXY_CIDRS)


def _resolve_forwarded_chain(chain: list[IPAddress], *, fallback: str) -> str:
    """Walk the proxy chain from the nearest hop toward the originating peer."""

    for address in reversed(chain):
        if not _is_trusted_proxy(str(address)):
            return str(address)
    return str(chain[0]) if chain else fallback


def _forwarded_for_chain(value: str) -> list[IPAddress] | None:
    addresses: list[IPAddress] = []
    for element in value.split(","):
        for parameter in element.split(";"):
            name, separator, raw_value = parameter.strip().partition("=")
            if separator != "=" or name.lower() != "for":
                continue
            parsed = _parse_forwarded_value(raw_value)
            if parsed is None:
                return None
            addresses.append(parsed)
    return addresses or None


def _x_forwarded_for_chain(value: str) -> list[IPAddress] | None:
    values = [item.strip() for item in value.split(",")]
    if not values or any(not item for item in values):
        return None
    addresses = [_parse_ip(item) for item in values]
    if any(address is None for address in addresses):
        return None
    return [address for address in addresses if address is not None]


def _parse_forwarded_value(value: str) -> IPAddress | None:
    normalized = value.strip().strip('"')
    if normalized.startswith("["):
        host, separator, remainder = normalized[1:].partition("]")
        if separator != "]" or (remainder and not remainder.startswith(":")):
            return None
        return _parse_ip(host)
    if normalized.count(":") == 1:
        host, _, port = normalized.partition(":")
        if port.isdigit():
            normalized = host
    return _parse_ip(normalized)


def _parse_ip(value: str) -> IPAddress | None:
    try:
        return ip_address(value)
    except ValueError:
        return None
