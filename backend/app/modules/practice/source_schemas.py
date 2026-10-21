from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class StrictPracticeSourceModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PracticeStepNoteRead(StrictPracticeSourceModel):
    step_note_id: str
    event_id: str
    pitch: str
    render_note_id: str
    measure_numbers: list[str] = Field(default_factory=list)
    staff_ids: list[str] = Field(default_factory=list)
    voice_ids: list[str] = Field(default_factory=list)


class PracticeAttackTargetRead(StrictPracticeSourceModel):
    attack_id: str
    pitch: str
    notes: list[PracticeStepNoteRead] = Field(default_factory=list)
    event_ids: list[str] = Field(default_factory=list)
    render_note_ids: list[str] = Field(default_factory=list)
    measure_numbers: list[str] = Field(default_factory=list)


class PracticeTargetRead(StrictPracticeSourceModel):
    index: int
    group_id: str
    onset_beat: float
    event_ids: list[str] = Field(default_factory=list)
    render_note_ids: list[str] = Field(default_factory=list)
    pitches: list[str] = Field(default_factory=list)
    measure_numbers: list[str] = Field(default_factory=list)
    staff_ids: list[str] = Field(default_factory=list)
    voice_ids: list[str] = Field(default_factory=list)
    step_id: str
    attack_targets: list[PracticeAttackTargetRead] = Field(default_factory=list)
    continuation: list[PracticeStepNoteRead] = Field(default_factory=list)


class PracticeTargetCatalogRead(StrictPracticeSourceModel):
    score_id: str
    revision_id: str
    targets: list[PracticeTargetRead] = Field(default_factory=list)


class PracticeReadyScoreContentRead(StrictPracticeSourceModel):
    score_id: str
    revision_id: str
    content: str
    mime_type: str = "application/vnd.recordare.musicxml+xml"


class PracticeScoreEventRead(StrictPracticeSourceModel):
    eventId: str
    onsetBeat: float
    durationBeats: float
    pitches: list[str]
    renderNoteIds: list[str]
    measureNumbers: list[str]
    staffIds: list[str]
    voiceIds: list[str]
    tieTypes: list[str]
    playable: bool
    entryCandidate: bool


class PracticeScoreExpectedNoteRead(StrictPracticeSourceModel):
    expectedNoteId: str
    eventId: str
    pitch: str
    renderNoteId: str
    measureNumbers: list[str]


class PracticeScoreExpectedStrikeTargetRead(StrictPracticeSourceModel):
    strikeId: str
    pitch: str
    expectedNotes: list[PracticeScoreExpectedNoteRead]
    eventIds: list[str]
    renderNoteIds: list[str]
    measureNumbers: list[str]


class PracticeScoreExpectedGroupRead(StrictPracticeSourceModel):
    groupId: str
    onsetBeat: float
    eventIds: list[str]
    expectedNotes: list[PracticeScoreExpectedNoteRead]
    strikeTargets: list[PracticeScoreExpectedStrikeTargetRead]
    renderNoteIds: list[str]
    pitches: list[str]
    measureNumbers: list[str]
    staffIds: list[str]
    voiceIds: list[str]
    canonicalEndBeat: float


class PracticeScoreStepNoteRead(StrictPracticeSourceModel):
    stepNoteId: str
    eventId: str
    pitch: str
    renderNoteId: str
    measureNumbers: list[str]
    staffIds: list[str]
    voiceIds: list[str]


class PracticeScoreAttackTargetRead(StrictPracticeSourceModel):
    attackId: str
    pitch: str
    notes: list[PracticeScoreStepNoteRead]
    eventIds: list[str]
    renderNoteIds: list[str]
    measureNumbers: list[str]


class PracticeScoreAttackStepRead(StrictPracticeSourceModel):
    stepId: str
    onsetBeat: float
    eventIds: list[str]
    attackTargets: list[PracticeScoreAttackTargetRead]
    continuation: list[PracticeScoreStepNoteRead]
    renderNoteIds: list[str]
    measureNumbers: list[str]
    staffIds: list[str]
    voiceIds: list[str]


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
    schemaVersion: Literal[1]
    scoreId: str
    revisionId: str
    artifactId: str
    playableEvents: list[PracticeScoreEventRead]
    expectedPracticeGroups: list[PracticeScoreExpectedGroupRead]
    practiceAttackSteps: list[PracticeScoreAttackStepRead]
    meterSegments: list[PracticeScoreMeterSegmentRead]
    scoreTempoSegments: list[PracticeScoreTempoSegmentRead]
    firstPlayableBeat: float | None
    scoreEndBeat: float
