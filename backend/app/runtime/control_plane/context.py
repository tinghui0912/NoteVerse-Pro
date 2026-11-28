"""Process-owned configuration and database resources."""

from dataclasses import dataclass
from app.composition.delivery_services import OpsDeliveries, build_ops_deliveries
from app.platform.config.delivery import OpsDeliveryConfig
from functools import lru_cache
from sqlalchemy import Engine
from sqlalchemy.orm import Session, sessionmaker
from app.platform.db.engine import build_engine, build_session_factory
from app.runtime.control_plane.settings import ControlPlaneSettings


@dataclass(frozen=True)
class RuntimeContext:
    settings: ControlPlaneSettings
    engine: Engine
    sessions: sessionmaker[Session]
    deliveries: OpsDeliveries


@lru_cache(maxsize=1)
def get_context() -> RuntimeContext:
    config = ControlPlaneSettings()
    engine = build_engine(config)
    sessions = build_session_factory(engine)
    deliveries = build_ops_deliveries(OpsDeliveryConfig.model_validate(config.model_dump()))
    return RuntimeContext(config, engine, sessions, deliveries)
