from __future__ import annotations

from app.shared.time import Instant

from pydantic import BaseModel

from app.db.models.score import MetadataStatus
from app.processing.musicxml.metadata import KeySignatureEvent, TimeSignatureEvent, TempoEvent


class MetadataRead(BaseModel):
    revision_id: str
    status: MetadataStatus
    notation_title: str | None
    measure_count: int | None
    playback_duration_ms: int | None
    part_count: int | None
    primary_key_fifths: int | None
    primary_mode: str | None
    key_signature_events: list[KeySignatureEvent]
    time_signature_events: list[TimeSignatureEvent]
    tempo_events: list[TempoEvent]
    computed_at: Instant | None
