from __future__ import annotations

from dataclasses import asdict, is_dataclass
import hashlib
import json
from typing import Any, Sequence

from app.processing.engines.practice_alignment.score_timeline import (
    PracticeScoreTimeline,
)
from app.processing.practice_score.tempo import PracticeTempoSegment


PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION = 2


def practice_score_artifact_from_timeline(
    timeline: PracticeScoreTimeline,
    *,
    score_id: str,
    revision_id: str,
    score_tempo_segments: Sequence[PracticeTempoSegment],
) -> dict[str, Any]:
    """Serialize the canonical backend practice timeline for browser-local runtimes."""

    payload: dict[str, Any] = {
        "schemaVersion": PRACTICE_SCORE_ARTIFACT_SCHEMA_VERSION,
        "scoreId": score_id,
        "revisionId": revision_id,
        "artifactId": "",
        "playableEvents": [_camel_dataclass(event) for event in timeline.events if event.playable],
        "expectedPracticeGroups": [
            {
                **_camel_dataclass(group),
                "canonicalEndBeat": timeline.entry_group_end_beat(group.group_id),
            }
            for group in timeline.expected_practice_groups
        ],
        "practiceAttackSteps": [_camel_dataclass(step) for step in timeline.practice_attack_steps],
        "meterSegments": [_meter_segment(segment) for segment in timeline.meter_segments],
        "scoreTempoSegments": [_tempo_segment(segment) for segment in score_tempo_segments],
        "firstPlayableBeat": timeline.first_playable_beat,
        "scoreEndBeat": timeline.end_beat,
    }
    payload["artifactId"] = _artifact_id(payload)
    return payload


def practice_score_artifact_json(
    timeline: PracticeScoreTimeline,
    *,
    score_id: str,
    revision_id: str,
    score_tempo_segments: Sequence[PracticeTempoSegment],
) -> str:
    return json.dumps(
        practice_score_artifact_from_timeline(
            timeline,
            score_id=score_id,
            revision_id=revision_id,
            score_tempo_segments=score_tempo_segments,
        ),
        indent=2,
        sort_keys=True,
    ) + "\n"


def _artifact_id(payload: dict[str, Any]) -> str:
    identity_payload = {**payload, "artifactId": ""}
    digest = hashlib.sha256(
        json.dumps(identity_payload, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()[:16]
    return f"practice-score-artifact-v2:{digest}"


def _camel_dataclass(item: Any) -> Any:
    if is_dataclass(item):
        return {
            _camel_key(key): _camel_dataclass(value)
            for key, value in asdict(item).items()
        }
    if isinstance(item, tuple):
        return [_camel_dataclass(value) for value in item]
    if isinstance(item, list):
        return [_camel_dataclass(value) for value in item]
    if isinstance(item, dict):
        return {_camel_key(str(key)): _camel_dataclass(value) for key, value in item.items()}
    return item


def _meter_segment(segment) -> dict[str, Any]:
    return {
        "startBeat": segment.start_beat,
        "numerator": segment.numerator,
        "denominator": segment.denominator,
        "measureDurationBeats": segment.measure_duration_beats,
        "countInPulses": segment.count_in_pulses,
        "source": segment.source,
    }


def _tempo_segment(segment: PracticeTempoSegment) -> dict[str, Any]:
    return {
        "startBeat": segment.start_beat,
        "bpm": segment.bpm,
    }


def _camel_key(value: str) -> str:
    parts = value.split("_")
    return parts[0] + "".join(part[:1].upper() + part[1:] for part in parts[1:])
