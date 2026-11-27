"""Process-owned configuration and database resources."""

from dataclasses import dataclass
from functools import lru_cache
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from app.platform.db.engine import build_engine, build_session_factory
from app.runtime.observability.settings import ObservabilitySettings


@dataclass(frozen=True)
class RuntimeContext:
    settings: ObservabilitySettings
    engine: Engine
    sessions: sessionmaker[Session]


@lru_cache(maxsize=1)
def get_context() -> RuntimeContext:
    config = ObservabilitySettings()
    engine = build_engine(config)
    return RuntimeContext(config, engine, build_session_factory(engine))
