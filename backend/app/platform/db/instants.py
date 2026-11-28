"""Persisted timestamp validation shared by every session factory."""

from datetime import datetime
from sqlalchemy import DateTime, event, inspect
from sqlalchemy.orm import Session
from app.shared.time import require_utc


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
