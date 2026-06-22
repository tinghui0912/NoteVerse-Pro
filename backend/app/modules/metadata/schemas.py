from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.db.models.score import MetadataStatus


class MetadataRead(BaseModel):
    revision_id: str
    status: MetadataStatus
    measure_count: int | None
    playback_duration_ms: int | None
    part_count: int | None
    primary_key_fifths: int | None
    primary_mode: str | None
    key_signature_events: list[dict[str, object]]
    time_signature_events: list[dict[str, object]]
    tempo_events: list[dict[str, object]]
    extractor_version: str
    error_code: str | None
    computed_at: datetime | None
