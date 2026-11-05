from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.modules.practice.score.time import MAX_JSON_SAFE_INTEGER
from app.modules.practice.score.timeline import assert_practice_timeline
from app.modules.practice.score.piano_key import PracticePianoKey
from app.modules.practice.score.domain import (
    PracticeScoreTimeline,
    PracticeScoreNote,
    PracticeScoreEvent,
    PracticeMoment,
    PracticeAttack,
    PracticeMeterSegment,
)


class StrictPracticeSourceModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class PracticeScoreNoteRead(StrictPracticeSourceModel):
    noteId: str
    eventId: str
    pianoKey: PracticePianoKey
    renderNoteId: str
    measureNumber: str
    staffId: str
    voiceId: str
    tieTypes: list[Literal["start", "stop"]]


class PracticeScoreEventRead(StrictPracticeSourceModel):
    eventId: str
    onsetTick: int = Field(ge=0, le=MAX_JSON_SAFE_INTEGER)
    durationTicks: int = Field(ge=0, le=MAX_JSON_SAFE_INTEGER)


class PracticeScoreAttackRead(StrictPracticeSourceModel):
    attackId: str
    pianoKey: PracticePianoKey
    noteIds: list[str]


class PracticeScoreMomentRead(StrictPracticeSourceModel):
    groupId: str
    onsetTick: int = Field(ge=0, le=MAX_JSON_SAFE_INTEGER)
    canonicalEndTick: int = Field(ge=0, le=MAX_JSON_SAFE_INTEGER)
    attacks: list[PracticeScoreAttackRead]
    continuationNoteIds: list[str]


class PracticeScoreMeterSegmentRead(StrictPracticeSourceModel):
    startTick: int = Field(ge=0, le=MAX_JSON_SAFE_INTEGER)
    numerator: int = Field(gt=0, le=MAX_JSON_SAFE_INTEGER)
    denominator: int = Field(gt=0, le=MAX_JSON_SAFE_INTEGER)


class PracticeScoreTempoSegmentRead(StrictPracticeSourceModel):
    startTick: int = Field(ge=0, le=MAX_JSON_SAFE_INTEGER)
    bpm: float


class PracticeScoreArtifactRead(StrictPracticeSourceModel):
    schemaVersion: Literal[1]
    scoreId: str
    revisionId: str
    artifactId: str
    notes: list[PracticeScoreNoteRead]
    events: list[PracticeScoreEventRead]
    moments: list[PracticeScoreMomentRead]
    meterSegments: list[PracticeScoreMeterSegmentRead] = Field(min_length=1)
    scoreTempoSegments: list[PracticeScoreTempoSegmentRead]
    ticksPerQuarter: int = Field(gt=0, le=MAX_JSON_SAFE_INTEGER)
    scoreEndTick: int = Field(ge=0, le=MAX_JSON_SAFE_INTEGER)

    @model_validator(mode="after")
    def canonical_ownership(self) -> Self:
        # Transport validation uses the canonical score-processing graph invariant.
        timeline = PracticeScoreTimeline(
            notes=tuple(
                PracticeScoreNote(
                    n.noteId,
                    n.eventId,
                    n.pianoKey,
                    n.renderNoteId,
                    n.measureNumber,
                    n.staffId,
                    n.voiceId,
                    tuple(n.tieTypes),
                )
                for n in self.notes
            ),
            events=tuple(
                PracticeScoreEvent(e.eventId, e.onsetTick, e.durationTicks) for e in self.events
            ),
            moments=tuple(
                PracticeMoment(
                    m.groupId,
                    m.onsetTick,
                    m.canonicalEndTick,
                    tuple(
                        PracticeAttack(a.attackId, a.pianoKey, tuple(a.noteIds)) for a in m.attacks
                    ),
                    tuple(m.continuationNoteIds),
                )
                for m in self.moments
            ),
            score_end_tick=self.scoreEndTick,
            ticks_per_quarter=self.ticksPerQuarter,
            meter_segments=tuple(
                PracticeMeterSegment(m.startTick, m.numerator, m.denominator)
                for m in self.meterSegments
            ),
        )
        assert_practice_timeline(timeline)
        if not self.scoreId or not self.revisionId or not self.artifactId:
            raise ValueError("Missing Practice artifact identity.")
        previous = -1
        for tempo in self.scoreTempoSegments:
            if (
                tempo.startTick > self.scoreEndTick
                or tempo.startTick < 0
                or tempo.startTick <= previous
                or tempo.bpm <= 0
            ):
                raise ValueError("Invalid score tempo chronology.")
            previous = tempo.startTick
        return self


class PracticeSourceNotationRead(StrictPracticeSourceModel):
    musicxml: str
    mime_type: Literal["application/vnd.recordare.musicxml+xml"] = (
        "application/vnd.recordare.musicxml+xml"
    )


class PracticeSourceRead(StrictPracticeSourceModel):
    source_id: str
    artifact: PracticeScoreArtifactRead
    notation: PracticeSourceNotationRead | None
