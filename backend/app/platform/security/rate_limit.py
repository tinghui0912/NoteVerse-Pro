"""Atomic Redis sliding windows with composite admission and explicit outage policy."""

from dataclasses import dataclass
from collections.abc import Sequence
from hashlib import sha256
from typing import Literal
from uuid import uuid4
from loguru import logger
from redis.exceptions import RedisError
from redis import Redis

SLIDING_WINDOW_SCRIPT = """
local stamp=redis.call('TIME')
local now=tonumber(stamp[1])*1000+math.floor(tonumber(stamp[2])/1000)
local retry=0
local remaining=nil
for i,key in ipairs(KEYS) do
  local cap=tonumber(ARGV[i*2])
  local window=tonumber(ARGV[i*2+1])
  redis.call('ZREMRANGEBYSCORE',key,'-inf',now-window)
  local count=redis.call('ZCARD',key)
  local left=cap-count
  if remaining==nil or left<remaining then remaining=left end
  if count>=cap then
    local oldest=redis.call('ZRANGE',key,0,0,'WITHSCORES')
    retry=math.max(retry,math.max(1,math.ceil((tonumber(oldest[2])+window-now)/1000)))
  end
end
if retry>0 then return {0,0,retry} end
for i,key in ipairs(KEYS) do
  redis.call('ZADD',key,now,ARGV[1])
  redis.call('PEXPIRE',key,tonumber(ARGV[i*2+1]))
end
return {1,remaining-1,0}
"""


@dataclass(frozen=True)
class RateLimitBucket:
    dimension: str
    identity: str
    limit: int
    window_seconds: int


@dataclass(frozen=True)
class RateLimitDecision:
    allowed: bool
    remaining: int
    retry_after_seconds: int


class RateLimitUnavailableError(Exception):
    """The configured admission authority cannot be reached."""


def identity_digest(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()


def normalized_email_digest(email: str) -> str:
    import unicodedata

    return identity_digest(unicodedata.normalize("NFC", email.strip()).casefold())


class RedisSlidingWindowLimiter:
    def __init__(self, client: Redis, *, namespace: str):
        if not namespace or len(namespace) > 192 or any(c in namespace for c in "{}*\r\n"):
            raise ValueError("A bounded explicit rate-limit namespace is required")
        self.client, self.namespace = client, namespace

    def check(
        self,
        policy: str,
        buckets: Sequence[RateLimitBucket],
        *,
        failure_mode: Literal["fail_closed", "fail_open"],
    ) -> RateLimitDecision:
        if not buckets or any(bucket.limit < 1 or bucket.window_seconds < 1 for bucket in buckets):
            raise ValueError("Rate limits require positive capacities and windows")
        if (
            not policy
            or any(c in policy for c in "{}*")
            or failure_mode not in {"fail_closed", "fail_open"}
        ):
            raise ValueError("An explicit policy and outage mode are required")
        keys = [
            f"{self.namespace}:{{{policy}}}:{bucket.dimension}:{identity_digest(bucket.identity)}"
            for bucket in buckets
        ]
        args: list[str | int] = [uuid4().hex]
        for bucket in buckets:
            args.extend((bucket.limit, bucket.window_seconds * 1000))
        try:
            raw = self.client.eval(SLIDING_WINDOW_SCRIPT, len(keys), *keys, *args)
            return RateLimitDecision(bool(int(raw[0])), int(raw[1]), int(raw[2]))
        except (RedisError, OSError) as error:
            logger.bind(
                event="security.rate_limit_unavailable",
                rate_limit_policy=policy,
                failure_mode=failure_mode,
                exception_type=type(error).__name__,
            ).warning("Redis admission unavailable")
            if failure_mode == "fail_closed":
                raise RateLimitUnavailableError() from None
            return RateLimitDecision(True, 0, 0)
