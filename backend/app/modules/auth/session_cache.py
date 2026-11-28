"""Redis read-through hints; PostgreSQL determines authorization on every request."""

import json
from dataclasses import dataclass
from uuid import UUID
from redis import Redis
from redis.exceptions import RedisError
from app.core.logger import logger


@dataclass(frozen=True)
class SessionHint:
    session_id: UUID
    user_id: int


class SessionCache:
    def __init__(self, redis: Redis, *, ttl_seconds: int) -> None:
        self.redis, self.ttl_seconds = redis, ttl_seconds

    @staticmethod
    def _key(digest: str) -> str:
        return "consumer-session:" + digest

    def read(self, digest: str) -> SessionHint | None:
        try:
            value = self.redis.get(self._key(digest))
            if value is None:
                return None
            payload = json.loads(value)
            return SessionHint(UUID(payload["session_id"]), int(payload["user_id"]))
        except (RedisError, ValueError, KeyError, TypeError):
            logger.bind(event="session.cache_read_unavailable").warning(
                "Session lookup uses PostgreSQL authority"
            )
            return None

    def remember(self, digest: str, hint: SessionHint, *, remaining_seconds: int) -> None:
        ttl = min(self.ttl_seconds, remaining_seconds)
        if ttl <= 0:
            return
        try:
            self.redis.setex(
                self._key(digest),
                ttl,
                json.dumps({"session_id": str(hint.session_id), "user_id": hint.user_id}),
            )
        except RedisError:
            logger.bind(event="session.cache_write_unavailable").warning(
                "Session cache is unavailable"
            )

    def evict(self, digests: list[str]) -> None:
        if not digests:
            return
        try:
            with self.redis.pipeline(transaction=False) as pipeline:
                for digest in digests:
                    pipeline.delete(self._key(digest))
                pipeline.execute()
        except RedisError:
            logger.bind(event="session.cache_eviction_unavailable").warning(
                "PostgreSQL revocation remains authoritative"
            )
