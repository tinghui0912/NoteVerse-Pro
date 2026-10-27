from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator


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

    @model_validator(mode="after")
    def physical_notation(self) -> Self:
        _assert_target_notation(
            self.pitch, [n.pitch for n in self.notes],
            [n.render_note_id for n in self.notes], self.render_note_ids,
        )
        return self


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

    @model_validator(mode="after")
    def physical_targets(self) -> Self:
        pitches = _physical_pitch_set(self.pitches)
        if _physical_pitch_set([t.pitch for t in self.attack_targets]) != pitches:
            raise ValueError("Practice target attack pitches disagree with physical pitches.")
        return self


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

    @model_validator(mode="after")
    def physical_notation(self) -> Self:
        _assert_target_notation(
            self.pitch, [n.pitch for n in self.expectedNotes],
            [n.renderNoteId for n in self.expectedNotes], self.renderNoteIds,
        )
        return self


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

    @model_validator(mode="after")
    def physical_targets(self) -> Self:
        if _physical_pitch_set([t.pitch for t in self.strikeTargets]) != _physical_pitch_set(self.pitches):
            raise ValueError("Practice group strike pitches disagree with physical pitches.")
        expected = {n.expectedNoteId: n for n in self.expectedNotes}
        if len(expected) != len(self.expectedNotes):
            raise ValueError("Practice group has duplicate expected-note identity.")
        owned: set[str] = set()
        for target in self.strikeTargets:
            for note in target.expectedNotes:
                if note.expectedNoteId in owned or expected.get(note.expectedNoteId) != note:
                    raise ValueError("Practice strike expected-note partition is corrupt.")
                owned.add(note.expectedNoteId)
        if owned != expected.keys():
            raise ValueError("Practice strike expected-note partition is incomplete.")
        return self


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

    @model_validator(mode="after")
    def physical_notation(self) -> Self:
        _assert_target_notation(
            self.pitch, [n.pitch for n in self.notes],
            [n.renderNoteId for n in self.notes], self.renderNoteIds,
        )
        return self


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

    @model_validator(mode="after")
    def physical_targets(self) -> Self:
        _physical_pitch_set([t.pitch for t in self.attackTargets])
        return self


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

    @model_validator(mode="after")
    def physical_targets(self) -> Self:
        if len(self.expectedPracticeGroups) != len(self.practiceAttackSteps):
            raise ValueError("Practice artifact requires one attack step per expected group.")
        for group, step in zip(self.expectedPracticeGroups, self.practiceAttackSteps, strict=True):
            if _physical_pitch_set(group.pitches) != _physical_pitch_set([t.pitch for t in step.attackTargets]):
                raise ValueError("Practice artifact attack/group physical pitches disagree.")
        return self


def _physical_pitch_set(pitches: list[str]) -> set[str]:
    if any(not pitch for pitch in pitches) or len(set(pitches)) != len(pitches):
        raise ValueError("Practice physical target pitches must be nonempty and unique.")
    return set(pitches)


def _assert_target_notation(pitch: str, note_pitches: list[str], note_render_ids: list[str], render_ids: list[str]) -> None:
    if not note_pitches or any(note_pitch != pitch for note_pitch in note_pitches):
        raise ValueError("Practice target notation pitches are corrupt.")
    if len(set(render_ids)) != len(render_ids) or set(render_ids) != set(note_render_ids):
        raise ValueError("Practice target render-note identities are corrupt.")
