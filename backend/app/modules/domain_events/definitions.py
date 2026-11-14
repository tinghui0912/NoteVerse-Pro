"""A fact's semantic identity is separate from its versioned payload."""

from typing import ClassVar

from pydantic import BaseModel, ConfigDict


class DomainFact(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)

    event_type: ClassVar[str]
    schema_version: ClassVar[int]
    aggregate_type: ClassVar[str]

    @property
    def aggregate_id(self) -> str:
        raise NotImplementedError

    @property
    def dedupe_key(self) -> str:
        raise NotImplementedError
