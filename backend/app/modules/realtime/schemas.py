from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel

REALTIME_EVENT_SCHEMA_VERSION = 1


class RealtimeEventRead(BaseModel):
    schema_version: int = REALTIME_EVENT_SCHEMA_VERSION
    event_id: str
    sequence: int
    type: str
    score_id: str | None = None
    revision_id: str | None = None
    payload: dict[str, Any]
    created_at: datetime
