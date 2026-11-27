"""Musical semantic admission of structurally decoded Practice artifact values."""

from collections.abc import Mapping
from typing import Any
from .timeline import assert_practice_timeline
from .domain import (
    PracticeScoreTimeline,
    PracticeScoreNote,
    PracticeScoreEvent,
    PracticeMoment,
    PracticeAttack,
    PracticeMeterSegment,
)


def validate_practice_score_artifact(value: Mapping[str, Any]) -> None:
    """Consume a structural transport value; the Practice score domain owns its graph truth."""
    timeline = PracticeScoreTimeline(
        notes=tuple(
            PracticeScoreNote(
                n["noteId"],
                n["eventId"],
                n["pianoKey"],
                n["renderNoteId"],
                n["measureNumber"],
                n["staffId"],
                n["voiceId"],
                tuple(n["tieTypes"]),
            )
            for n in value["notes"]
        ),
        events=tuple(
            PracticeScoreEvent(e["eventId"], e["onsetTick"], e["durationTicks"])
            for e in value["events"]
        ),
        moments=tuple(
            PracticeMoment(
                m["groupId"],
                m["onsetTick"],
                m["canonicalEndTick"],
                tuple(
                    PracticeAttack(a["attackId"], a["pianoKey"], tuple(a["noteIds"]))
                    for a in m["attacks"]
                ),
                tuple(m["continuationNoteIds"]),
            )
            for m in value["moments"]
        ),
        score_end_tick=value["scoreEndTick"],
        ticks_per_quarter=value["ticksPerQuarter"],
        meter_segments=tuple(
            PracticeMeterSegment(m["startTick"], m["numerator"], m["denominator"])
            for m in value["meterSegments"]
        ),
    )
    assert_practice_timeline(timeline)
    previous = -1
    for tempo in value["scoreTempoSegments"]:
        if tempo["startTick"] > value["scoreEndTick"] or tempo["startTick"] <= previous:
            raise ValueError("Invalid score tempo chronology.")
        previous = tempo["startTick"]
