from collections.abc import Generator
from datetime import datetime

from sqlalchemy import DateTime, create_engine, event, inspect
from sqlalchemy.orm import Session, sessionmaker

from app.core.config import settings
from app.shared.time import require_utc

engine = create_engine(
    settings.DATABASE_URL,
    connect_args={"options": "-c timezone=UTC"},
    pool_pre_ping=True,
    pool_recycle=3600,
    pool_size=5,
    max_overflow=10,
)
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def get_session() -> Generator[Session, None, None]:
    with SessionLocal() as session:
        try:
            yield session
        except BaseException:
            session.rollback()
            raise


@event.listens_for(Session, "before_flush")
def validate_persisted_instants(session: Session, _flush_context, _instances) -> None:
    """Persisted instant assignments must carry their timezone explicitly."""
    for row in session.new.union(session.dirty):
        state = inspect(row)
        for attribute in state.mapper.column_attrs:
            if not any(isinstance(column.type, DateTime) for column in attribute.columns):
                continue
            value = state.dict.get(attribute.key)
            if value is not None:
                if not isinstance(value, datetime):
                    raise ValueError("Persisted instants require aware datetime values")
                setattr(row, attribute.key, require_utc(value))
