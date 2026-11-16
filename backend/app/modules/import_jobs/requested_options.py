"""Versioned Import submission intent; every durable consumer uses this codec.

V1 field meaning is immutable. A shape or meaning change requires a new version
and an explicit decoder branch; unversioned or unsupported payloads are rejected.
"""

from typing import Literal

from pydantic import BaseModel, ConfigDict, field_validator

from app.modules.scores.genres import Genres
from app.modules.import_jobs.schemas import ImportJobRequestedOptions, requested_options_adapter


class ImportJobRequestedOptionsV1(BaseModel):
    model_config = ConfigDict(extra="forbid")

    schema_version: Literal[1]
    display_title: str | None
    genres: Genres

    @field_validator("schema_version", mode="before")
    @classmethod
    def exact_version(cls, value: object) -> object:
        if type(value) is not int or value != 1:
            raise ValueError("Unsupported Import requested-options schema version")
        return value


def encode_requested_options(options: ImportJobRequestedOptions | None) -> dict[str, object]:
    validated = requested_options_adapter.validate_python(options if options is not None else {})
    return ImportJobRequestedOptionsV1(
        schema_version=1,
        display_title=validated.get("display_title"),
        genres=validated.get("genres", []),
    ).model_dump(mode="json")


def decode_requested_options(payload: object) -> ImportJobRequestedOptionsV1:
    return ImportJobRequestedOptionsV1.model_validate(payload)
