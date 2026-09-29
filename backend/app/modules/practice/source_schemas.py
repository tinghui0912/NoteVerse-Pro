from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field


class PracticeStepNoteRead(BaseModel):
    step_note_id: str
    event_id: str
    pitch: str
    render_note_id: str
    measure_numbers: list[str] = Field(default_factory=list)
    staff_ids: list[str] = Field(default_factory=list)
    voice_ids: list[str] = Field(default_factory=list)


class PracticeAttackTargetRead(BaseModel):
    attack_id: str
    pitch: str
    notes: list[PracticeStepNoteRead] = Field(default_factory=list)
    event_ids: list[str] = Field(default_factory=list)
    render_note_ids: list[str] = Field(default_factory=list)
    measure_numbers: list[str] = Field(default_factory=list)


class PracticeTargetRead(BaseModel):
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


class PracticeTargetCatalogRead(BaseModel):
    score_id: str
    revision_id: str
    targets: list[PracticeTargetRead] = Field(default_factory=list)


class PracticeReadyScoreContentRead(BaseModel):
    score_id: str
    revision_id: str
    content: str
    mime_type: str = "application/vnd.recordare.musicxml+xml"


class PracticeScoreArtifactRead(BaseModel):
    schemaVersion: Literal[1] = 1
    scoreId: str
    revisionId: str
    artifactId: str
    playableEvents: list[dict[str, Any]] = Field(default_factory=list)
    expectedPracticeGroups: list[dict[str, Any]] = Field(default_factory=list)
    practiceAttackSteps: list[dict[str, Any]] = Field(default_factory=list)
    meterSegments: list[dict[str, Any]] = Field(default_factory=list)
    scoreTempoSegments: list[dict[str, Any]] = Field(default_factory=list)
    firstPlayableBeat: float | None = None
    scoreEndBeat: float
