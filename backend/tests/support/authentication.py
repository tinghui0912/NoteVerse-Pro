"""Explicit session composition and deterministic Redis command double for tests."""

from sqlalchemy.orm import sessionmaker
from app.platform.config.application import CustomerAuthConfig
from app.modules.auth.sessions_service import SessionService
from app.modules.auth.session_cache import SessionCache


class RedisMemory:
    def __init__(self):
        self.values = {}
        self.ttls = {}
        self.deletes = []

    def get(self, key):
        return self.values.get(key)

    def setex(self, key, ttl, value):
        self.values[key] = value
        self.ttls[key] = ttl

    def pipeline(self, **kwargs):
        return self

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def delete(self, key):
        self.values.pop(key, None)
        self.deletes.append(key)

    def execute(self):
        return []


def session_service(engine=None, *, redis=None):
    config = CustomerAuthConfig(AUTH_COOKIE_SECURE=False)
    return SessionService(
        config=config,
        cache=SessionCache(redis, ttl_seconds=120) if redis is not None else None,
        sessions=sessionmaker(engine) if engine is not None else None,
    )


def issue_session(db, user_id):
    token, _ = session_service().create_session(db, user_id)
    db.commit()
    return token
