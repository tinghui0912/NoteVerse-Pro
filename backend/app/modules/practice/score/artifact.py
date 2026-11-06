from __future__ import annotations

from dataclasses import asdict, is_dataclass
import hashlib
import json
from typing import Any, Sequence

from .domain import PracticeScoreTimeline, PracticeTempoSegment
from .timeline import assert_practice_timeline


PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 1


def practice_score_artifact_from_timeline(
    timeline: PracticeScoreTimeline,
    *,
    score_tempo_segments: Sequence[PracticeTempoSegment],
) -> dict[str, Any]:
    """Serialize the practice-ready score timeline for browser-local execution."""

    assert_practice_timeline(timeline)
    payload: dict[str, Any] = {
        "schemaVersion": PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION,
        "ticksPerQuarter": timeline.ticks_per_quarter,
        "artifactId": "",
        "notes": [_camel_dataclass(note) for note in timeline.notes],
        "events": [_camel_dataclass(event) for event in timeline.events],
        "moments": [_camel_dataclass(moment) for moment in timeline.moments],
        "meterSegments": [_meter_segment(segment) for segment in timeline.meter_segments],
        "scoreTempoSegments": [_tempo_segment(segment) for segment in score_tempo_segments],
        "scoreEndTick": timeline.score_end_tick,
    }
    payload["artifactId"] = practice_artifact_id(payload)
    return payload


def practice_score_artifact_json(
    timeline: PracticeScoreTimeline,
    *,
    score_tempo_segments: Sequence[PracticeTempoSegment],
) -> str:
    return (
        json.dumps(
            practice_score_artifact_from_timeline(
                timeline,
                score_tempo_segments=score_tempo_segments,
            ),
            indent=2,
            sort_keys=True,
        )
        + "\n"
    )


def canonical_practice_artifact_bytes(value: dict[str, Any]) -> bytes:
    """Deterministic JSON representation used for artifact content identity and storage."""
    return json.dumps(value, sort_keys=True, separators=(",", ":"), allow_nan=False).encode("utf-8")


def practice_artifact_id(payload: dict[str, Any]) -> str:
    identity_payload = {**payload, "artifactId": ""}
    digest = hashlib.sha256(canonical_practice_artifact_bytes(identity_payload)).hexdigest()[:16]
    return f"practice-score-artifact:{digest}"


def _camel_dataclass(item: Any) -> Any:
    if is_dataclass(item) and not isinstance(item, type):
        return {_camel_key(key): _camel_dataclass(value) for key, value in asdict(item).items()}
    if isinstance(item, tuple):
        return [_camel_dataclass(value) for value in item]
    if isinstance(item, list):
        return [_camel_dataclass(value) for value in item]
    if isinstance(item, dict):
        return {_camel_key(str(key)): _camel_dataclass(value) for key, value in item.items()}
    return item


def _meter_segment(segment) -> dict[str, Any]:
    return {
        "startTick": segment.start_tick,
        "numerator": segment.numerator,
        "denominator": segment.denominator,
    }


def _tempo_segment(segment: PracticeTempoSegment) -> dict[str, Any]:
    return {
        "startTick": segment.start_tick,
        "bpm": segment.bpm,
    }


def _camel_key(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])
