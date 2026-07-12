from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class RealtimeEventRead(BaseModel):
    event_id: str
    sequence: int
    type: str
    resource_type: str | None = None
    resource_id: str | None = None
    score_id: str | None = None
    revision_id: str | None = None
    payload: dict[str, Any]
    created_at: datetime
