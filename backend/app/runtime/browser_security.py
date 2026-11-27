"""HTTP composition of Redis admission and transport-peer identity."""

from collections.abc import Sequence
from typing import Literal
from fastapi import Request
from app.core.http_error_policy import RateLimitHttpException
from redis import Redis
from redis.backoff import NoBackoff
from redis.retry import Retry
from app.platform.config.browser_abuse import RateLimitConnectionSettings, AuthenticationRatePolicy
from app.platform.security.client_ip import client_ip
from app.platform.security.rate_limit import (
    RedisSlidingWindowLimiter,
    RateLimitBucket,
    RateLimitUnavailableError,
)


def create_rate_limiter(
    config: RateLimitConnectionSettings, *, redis_url: str, surface: str
) -> RedisSlidingWindowLimiter:
    client = Redis.from_url(
        redis_url,
        socket_timeout=config.RATE_LIMIT_REDIS_TIMEOUT_SECONDS,
        socket_connect_timeout=config.RATE_LIMIT_REDIS_TIMEOUT_SECONDS,
        retry=Retry(NoBackoff(), 0),
    )
    return RedisSlidingWindowLimiter(client, namespace=f"{config.RATE_LIMIT_NAMESPACE}:{surface}")


async def json_command_fields(request: Request) -> dict[str, object]:
    try:
        value = await request.json()
    except ValueError:
        return {}
    return value if isinstance(value, dict) else {}


def get_rate_limiter(request: Request) -> RedisSlidingWindowLimiter:
    return request.app.state.rate_limiter


def request_client_ip(request: Request) -> str:
    config = request.app.state.settings
    return client_ip(
        request.scope,
        trusted_proxy_hops=config.TRUSTED_PROXY_HOPS,
        trusted_proxy_cidrs=config.TRUSTED_PROXY_CIDRS,
    )


def enforce(
    limiter: RedisSlidingWindowLimiter,
    policy: str,
    buckets: Sequence[RateLimitBucket],
    *,
    failure_mode: Literal["fail_closed", "fail_open"],
) -> None:
    try:
        result = limiter.check(policy, buckets, failure_mode=failure_mode)
    except RateLimitUnavailableError:
        raise RateLimitHttpException(status_code=503, retry_after_seconds=1) from None
    if not result.allowed:
        raise RateLimitHttpException(
            status_code=429, retry_after_seconds=result.retry_after_seconds
        )


def authentication_buckets(
    request: Request, policy: AuthenticationRatePolicy, *, dimension: str, identity: str
) -> tuple[RateLimitBucket, ...]:
    return (
        RateLimitBucket("ip", request_client_ip(request), policy.ip_limit, policy.window_seconds),
        RateLimitBucket(dimension, identity, policy.identity_limit, policy.window_seconds),
    )
