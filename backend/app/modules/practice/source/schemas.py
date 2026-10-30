from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, model_validator

from app.processing.practice_score.piano_key import PracticePianoKey
from app.processing.practice_score.score_timeline import (
    PracticeScoreTimeline,
    PracticeScoreNote,
    PracticeScoreEvent,
    PracticeMoment,
    PracticeAttack,
    assert_practice_timeline,
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
    onsetBeat: float
    durationBeats: float


class PracticeScoreAttackRead(StrictPracticeSourceModel):
    attackId: str
    pianoKey: PracticePianoKey
    noteIds: list[str]


class PracticeScoreMomentRead(StrictPracticeSourceModel):
    groupId: str
    onsetBeat: float
    canonicalEndBeat: float
    attacks: list[PracticeScoreAttackRead]
    continuationNoteIds: list[str]


class PracticeScoreMeterSegmentRead(StrictPracticeSourceModel):
    startBeat: float
    numerator: int
    denominator: int
    measureDurationBeats: float
    countInPulses: int
    source: Literal["MUSICXML", "DEFAULT_4_4"]


class PracticeScoreTempoSegmentRead(StrictPracticeSourceModel):
    startBeat: float
    bpm: float


class PracticeScoreArtifactRead(StrictPracticeSourceModel):
    schemaVersion: Literal[3]
    scoreId: str
    revisionId: str
    artifactId: str
    notes: list[PracticeScoreNoteRead]
    events: list[PracticeScoreEventRead]
    moments: list[PracticeScoreMomentRead]
    meterSegments: list[PracticeScoreMeterSegmentRead]
    scoreTempoSegments: list[PracticeScoreTempoSegmentRead]
    firstPlayableBeat: float
    scoreEndBeat: float

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
                PracticeScoreEvent(e.eventId, e.onsetBeat, e.durationBeats) for e in self.events
            ),
            moments=tuple(
                PracticeMoment(
                    m.groupId,
                    m.onsetBeat,
                    m.canonicalEndBeat,
                    tuple(
                        PracticeAttack(a.attackId, a.pianoKey, tuple(a.noteIds)) for a in m.attacks
                    ),
                    tuple(m.continuationNoteIds),
                )
                for m in self.moments
            ),
            first_playable_beat=self.firstPlayableBeat,
            end_beat=self.scoreEndBeat,
        )
        assert_practice_timeline(timeline)
        if not self.scoreId or not self.revisionId or not self.artifactId:
            raise ValueError("Missing Practice artifact identity.")
        previous = -1.0
        for tempo in self.scoreTempoSegments:
            if tempo.startBeat < 0 or tempo.startBeat <= previous or tempo.bpm <= 0:
                raise ValueError("Invalid score tempo chronology.")
            previous = tempo.startBeat
        previous = -1.0
        for meter in self.meterSegments:
            if (
                meter.startBeat < 0
                or meter.startBeat <= previous
                or meter.numerator < 1
                or meter.denominator < 1
                or meter.measureDurationBeats <= 0
                or meter.countInPulses < 0
            ):
                raise ValueError("Invalid meter contract.")
            previous = meter.startBeat
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
