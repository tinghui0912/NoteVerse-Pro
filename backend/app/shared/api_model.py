"""Typed API representation serialization with explicit UTC timestamps."""

from collections.abc import Mapping, Sequence
from datetime import datetime
from typing import Any

from pydantic import BaseModel, SerializationInfo, SerializerFunctionWrapHandler, model_serializer

from app.shared.time import require_utc


def format_utc_datetime(value: datetime) -> str:
    return require_utc(value).isoformat().replace("+00:00", "Z")


def serialize_utc_values(value: Any) -> Any:
    """Serialize nested timezone-aware UTC instants without changing field shape."""
    if isinstance(value, datetime):
        return format_utc_datetime(value)
    if isinstance(value, BaseModel):
        return serialize_utc_values(value.model_dump(mode="python"))
    if isinstance(value, Mapping):
        return {str(key): serialize_utc_values(item) for key, item in value.items()}
    if isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        return [serialize_utc_values(item) for item in value]
    return value


class ApiModel(BaseModel):
    """A representation model; fields are the HTTP body itself."""

    # A wrap serializer without a replacement return schema preserves each DTO's
    # field schema in OpenAPI, while Python-mode dumping retains datetime values.
    @model_serializer(mode="wrap", when_used="json")
    def serialize_representation(
        self, _handler: SerializerFunctionWrapHandler, info: SerializationInfo
    ):
        return serialize_utc_values(
            self.model_dump(
                mode="python",
                include=info.include,
                exclude=info.exclude,
                by_alias=info.by_alias,
                exclude_unset=info.exclude_unset,
                exclude_defaults=info.exclude_defaults,
                exclude_none=info.exclude_none,
                round_trip=info.round_trip,
                context=info.context,
            )
        )
