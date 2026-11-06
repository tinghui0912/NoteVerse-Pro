"""Generated from contracts/practice/score/artifact.schema.json. Do not edit."""
from __future__ import annotations
from typing import Annotated, Literal
from pydantic import BaseModel, ConfigDict, Field, field_validator

class ArtifactTransportModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)

class PracticeScoreEventRead(ArtifactTransportModel):
    durationTicks: Annotated[int, Field(ge=0, le=9007199254740991)]
    eventId: Annotated[str, Field(min_length=1)]
    onsetTick: Annotated[int, Field(ge=0, le=9007199254740991)]

class PracticeScoreMeterSegmentRead(ArtifactTransportModel):
    denominator: Annotated[int, Field(ge=1, le=9007199254740991)]
    numerator: Annotated[int, Field(ge=1, le=9007199254740991)]
    startTick: Annotated[int, Field(ge=0, le=9007199254740991)]

class PracticeScoreAttackRead(ArtifactTransportModel):
    attackId: Annotated[str, Field(min_length=1)]
    noteIds: Annotated[list[Annotated[str, Field(min_length=1)]], Field(min_length=1)]
    pianoKey: Annotated[int, Field(ge=21, le=108)]

class PracticeScoreMomentRead(ArtifactTransportModel):
    attacks: Annotated[list[PracticeScoreAttackRead], Field(min_length=1)]
    canonicalEndTick: Annotated[int, Field(ge=0, le=9007199254740991)]
    continuationNoteIds: list[Annotated[str, Field(min_length=1)]]
    groupId: Annotated[str, Field(min_length=1)]
    onsetTick: Annotated[int, Field(ge=0, le=9007199254740991)]

class PracticeScoreNoteRead(ArtifactTransportModel):
    eventId: Annotated[str, Field(min_length=1)]
    measureNumber: str
    noteId: Annotated[str, Field(min_length=1)]
    pianoKey: Annotated[int, Field(ge=21, le=108)]
    renderNoteId: Annotated[str, Field(min_length=1)]
    staffId: str
    tieTypes: Annotated[list[Literal['start', 'stop']], Field(json_schema_extra={"uniqueItems": True})]
    voiceId: str

    @field_validator("tieTypes")
    @classmethod
    def unique_tieTypes(cls, value: list[str]) -> list[str]:
        if len(value) != len(set(value)):
            raise ValueError("Duplicate array value")
        return value

class PracticeScoreTempoSegmentRead(ArtifactTransportModel):
    bpm: Annotated[float, Field(gt=0)]
    startTick: Annotated[int, Field(ge=0, le=9007199254740991)]

class PracticeScoreArtifactRead(ArtifactTransportModel):
    artifactId: Annotated[str, Field(min_length=40, max_length=40, pattern='^practice-score-artifact:[0-9a-f]{16}$')]
    events: Annotated[list[PracticeScoreEventRead], Field(min_length=1)]
    meterSegments: Annotated[list[PracticeScoreMeterSegmentRead], Field(min_length=1)]
    moments: Annotated[list[PracticeScoreMomentRead], Field(min_length=1)]
    notes: Annotated[list[PracticeScoreNoteRead], Field(min_length=1)]
    schemaVersion: Literal[1]
    scoreEndTick: Annotated[int, Field(ge=0, le=9007199254740991)]
    scoreTempoSegments: list[PracticeScoreTempoSegmentRead]
    ticksPerQuarter: Annotated[int, Field(ge=1, le=9007199254740991)]

    @field_validator("schemaVersion", mode="before")
    @classmethod
    def strict_schemaVersion(cls, value: object) -> object:
        if type(value) is not int:
            raise ValueError("Wrong constant primitive type")
        return value
