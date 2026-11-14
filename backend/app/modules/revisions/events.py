"""Immutable revision-admission facts, independent of browser delivery."""

from typing import ClassVar
from pydantic import Field
from app.modules.domain_events.definitions import DomainFact
from app.db.models.score import RevisionOrigin


class ScoreRevisionCreated(DomainFact):
    event_type: ClassVar[str] = "score.revision.created"
    schema_version: ClassVar[int] = 1
    aggregate_type: ClassVar[str] = "score"
    score_id: str = Field(min_length=1)
    revision_id: str = Field(min_length=1)
    revision_number: int = Field(ge=1)
    actor_user_id: int = Field(gt=0)
    actor_name: str
    score_title: str
    origin: RevisionOrigin
    is_initial: bool
    restored_from_revision_id: str | None
    audience_user_ids: tuple[int, ...]

    @property
    def aggregate_id(self) -> str:
        return self.score_id

    @property
    def dedupe_key(self) -> str:
        return f"{self.event_type}:{self.revision_id}"
