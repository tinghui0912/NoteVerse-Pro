"""Only identity, executed mode/input/scope and a server completion acknowledgement."""

from typing import Self
from pydantic import BaseModel, ConfigDict, Field, model_validator
from app.db.models.practice_activity import (
    PracticeActivityMode,
    PracticeActivityInputSource,
    PracticeActivityScopeKind,
)
from app.shared.api_model import ApiModel
from app.shared.time import Instant


class PracticeActivityBinding(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    score_id: str = Field(min_length=1, max_length=128)
    revision_id: str = Field(min_length=1, max_length=128)
    bundle_id: str = Field(min_length=1, max_length=128)


class PracticeActivityScope(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    kind: PracticeActivityScopeKind
    start_tick: int = Field(strict=True, ge=0, le=2**53 - 1)
    terminal_tick: int = Field(strict=True, gt=0, le=2**53 - 1)

    @model_validator(mode="after")
    def validate_order(self) -> Self:
        if self.terminal_tick <= self.start_tick:
            raise ValueError("Activity scope must have a positive tick span")
        return self


class PracticeActivityCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)
    client_session_id: str = Field(min_length=1, max_length=128)
    practice_binding: PracticeActivityBinding
    mode: PracticeActivityMode
    input_source: PracticeActivityInputSource
    scope: PracticeActivityScope


class PracticeActivityRead(ApiModel):
    activity_id: str
    completed_at: Instant
