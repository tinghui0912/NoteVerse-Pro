"""Explicit JSON persistence boundary for revision metadata events."""

from pydantic import TypeAdapter

from app.processing.musicxml.metadata import KeySignatureEvent, TimeSignatureEvent, TempoEvent

_key_events = TypeAdapter(list[KeySignatureEvent])
_time_events = TypeAdapter(list[TimeSignatureEvent])
_tempo_events = TypeAdapter(list[TempoEvent])


def encode_key_signature_events(events: list[KeySignatureEvent]) -> list[dict[str, object]]:
    return [event.model_dump(mode="json") for event in events]


def encode_time_signature_events(events: list[TimeSignatureEvent]) -> list[dict[str, object]]:
    return [event.model_dump(mode="json") for event in events]


def encode_tempo_events(events: list[TempoEvent]) -> list[dict[str, object]]:
    return [event.model_dump(mode="json") for event in events]


def decode_key_signature_events(payload: object) -> list[KeySignatureEvent]:
    return _key_events.validate_python(payload, strict=True)


def decode_time_signature_events(payload: object) -> list[TimeSignatureEvent]:
    return _time_events.validate_python(payload, strict=True)


def decode_tempo_events(payload: object) -> list[TempoEvent]:
    return _tempo_events.validate_python(payload, strict=True)
