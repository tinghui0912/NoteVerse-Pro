"""Trusted reverse-proxy CIDR allowlist settings."""

import json
from ipaddress import ip_network

from pydantic import BaseModel, field_validator


class TrustedProxySettings(BaseModel):
    """Forwarded-header trust boundary for immediate reverse-proxy peers."""

    TRUSTED_PROXY_CIDRS: list[str]

    @field_validator("TRUSTED_PROXY_CIDRS", mode="before")
    @classmethod
    def parse_trusted_proxy_cidrs(cls, value: str | list[str]) -> list[str]:
        if isinstance(value, str):
            try:
                value = json.loads(value)
            except json.JSONDecodeError as exc:
                raise ValueError("TRUSTED_PROXY_CIDRS must be a JSON array") from exc
        if not isinstance(value, list) or not all(isinstance(item, str) for item in value):
            raise ValueError("TRUSTED_PROXY_CIDRS must be a JSON array")
        try:
            networks = [ip_network(item, strict=False) for item in value]
        except ValueError as exc:
            raise ValueError("TRUSTED_PROXY_CIDRS must contain valid IP networks") from exc
        if any(network.prefixlen == 0 for network in networks):
            raise ValueError("TRUSTED_PROXY_CIDRS must not trust every address")
        return [str(network) for network in networks]
