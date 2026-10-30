from __future__ import annotations

from typing import Literal, Self

from pydantic import BaseModel, ConfigDict, model_validator

from app.processing.practice_score.piano_key import PracticePianoKey


class StrictPracticeSourceModel(BaseModel):
    model_config = ConfigDict(extra="forbid")


class PracticeReadyScoreContentRead(StrictPracticeSourceModel):
    score_id: str
    revision_id: str
    content: str
    mime_type: str = "application/vnd.recordare.musicxml+xml"


class PracticeScoreEventRead(StrictPracticeSourceModel):
    eventId: str
    onsetBeat: float
    durationBeats: float
    pianoKeys: list[PracticePianoKey]
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
    pianoKey: PracticePianoKey
    renderNoteId: str
    measureNumbers: list[str]


class PracticeScoreExpectedStrikeTargetRead(StrictPracticeSourceModel):
    strikeId: str
    pianoKey: PracticePianoKey
    expectedNotes: list[PracticeScoreExpectedNoteRead]
    eventIds: list[str]
    renderNoteIds: list[str]
    measureNumbers: list[str]

    @model_validator(mode="after")
    def physical_notation(self) -> Self:
        _assert_target_notation(
            self.pianoKey, [n.pianoKey for n in self.expectedNotes],
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
    pianoKeys: list[PracticePianoKey]
    measureNumbers: list[str]
    staffIds: list[str]
    voiceIds: list[str]
    canonicalEndBeat: float

    @model_validator(mode="after")
    def physical_targets(self) -> Self:
        if _physical_key_set([t.pianoKey for t in self.strikeTargets]) != _physical_key_set(self.pianoKeys):
            raise ValueError("Practice group strike pianoKeys disagree with physical pianoKeys.")
        _assert_unique_identities([n.expectedNoteId for n in self.expectedNotes], "expected-note")
        _assert_exact_identity_aggregate([n.renderNoteId for n in self.expectedNotes], self.renderNoteIds)
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
    pianoKey: PracticePianoKey
    renderNoteId: str
    measureNumbers: list[str]
    staffIds: list[str]
    voiceIds: list[str]


class PracticeScoreAttackTargetRead(StrictPracticeSourceModel):
    attackId: str
    pianoKey: PracticePianoKey
    notes: list[PracticeScoreStepNoteRead]
    eventIds: list[str]
    renderNoteIds: list[str]
    measureNumbers: list[str]

    @model_validator(mode="after")
    def physical_notation(self) -> Self:
        _assert_target_notation(
            self.pianoKey, [n.pianoKey for n in self.notes],
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
        _physical_key_set([t.pianoKey for t in self.attackTargets])
        notes = [n for target in self.attackTargets for n in target.notes] + self.continuation
        _assert_unique_identities([n.stepNoteId for n in notes], "step-note")
        _assert_exact_identity_aggregate([n.renderNoteId for n in notes], self.renderNoteIds)
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
    schemaVersion: Literal[2]
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
        if not self.playableEvents or not self.expectedPracticeGroups or len(self.expectedPracticeGroups) != len(self.practiceAttackSteps):
            raise ValueError("Practice artifact requires one attack step per expected group.")
        for group, step in zip(self.expectedPracticeGroups, self.practiceAttackSteps, strict=True):
            if _physical_key_set(group.pianoKeys) != _physical_key_set([t.pianoKey for t in step.attackTargets]):
                raise ValueError("Practice artifact attack/group physical pianoKeys disagree.")
        return self


def _physical_key_set(pianoKeys: list[PracticePianoKey]) -> set[int]:
    if not pianoKeys or len(set(pianoKeys)) != len(pianoKeys):
        raise ValueError("Practice physical target pianoKeys must be nonempty and unique.")
    return set(pianoKeys)


def _assert_target_notation(pianoKey: PracticePianoKey, note_keys: list[PracticePianoKey], note_render_ids: list[str], render_ids: list[str]) -> None:
    if not note_keys or any(note_key != pianoKey for note_key in note_keys):
        raise ValueError("Practice target notation pianoKeys are corrupt.")
    _assert_exact_identity_aggregate(note_render_ids, render_ids)


def _assert_unique_identities(identities: list[str], owner: str) -> None:
    if any(not identity for identity in identities) or len(set(identities)) != len(identities):
        raise ValueError(f"Practice {owner} identities must be nonempty and unique.")


def _assert_exact_identity_aggregate(nested: list[str], flat: list[str]) -> None:
    _assert_unique_identities(nested, "render-note")
    _assert_unique_identities(flat, "render-note")
    if sorted(nested) != sorted(flat):
        raise ValueError("Practice target render-note identities are corrupt.")
