"""Generated from contracts/realtime/events.schema.json. Do not edit."""

from enum import StrEnum
from datetime import datetime
import re
from typing import Annotated, Any, Literal
from pydantic import BeforeValidator, ConfigDict, Field, TypeAdapter, field_validator
from app.shared.api_model import ApiModel
from app.shared.time import Instant


class RealtimeChangeKind(StrEnum):
    NOTIFICATIONS_CHANGED = "notifications.changed"
    SCORE_REVISIONS_CHANGED = "score.revisions.changed"
    SCORE_DERIVED_ASSETS_CHANGED = "score.derived_assets.changed"
    SCORE_METADATA_CHANGED = "score.metadata.changed"
    IMPORT_JOBS_CHANGED = "import_jobs.changed"


_DATETIME_PATTERN = "^[0-9]{4}-[0-9]{2}-[0-9]{2}[Tt][0-9]{2}:[0-9]{2}:[0-9]{2}(?:\\.[0-9]+)?(?:[Zz]|[+-](?:[01][0-9]|2[0-3]):[0-5][0-9])$"


def _date_time(value: Any) -> Any:
    if isinstance(value, str):
        if re.fullmatch(_DATETIME_PATTERN, value) is None:
            raise ValueError("createdAt must be an RFC3339 aware instant")
        return datetime.fromisoformat(value.upper().replace("Z", "+00:00"))
    return value


class _RealtimeEvent(ApiModel):
    model_config = ConfigDict(extra="forbid", strict=True)

    @field_validator("schemaVersion", mode="before", check_fields=False)
    @classmethod
    def integer_version(cls, value: Any) -> Any:
        if type(value) is not int:
            raise ValueError("schemaVersion must be an integer")
        return value


class RealtimeCheckpointRead(_RealtimeEvent):
    schemaVersion: Literal[1]
    sequence: int = Field(ge=0, le=9007199254740991, strict=True)


class RealtimeResyncRequiredRead(_RealtimeEvent):
    schemaVersion: Literal[1]
    sequence: int = Field(ge=0, le=9007199254740991, strict=True)
    reason: Literal["retention_gap", "cursor_out_of_range", "invalid_cursor"]


class NotificationsChangedRead(_RealtimeEvent):
    schemaVersion: Literal[1]
    sequence: int = Field(ge=1, le=9007199254740991, strict=True)
    changeId: str = Field(min_length=1, strict=True)
    createdAt: Annotated[Instant, BeforeValidator(_date_time)]
    kind: Literal["notifications.changed"]
    notificationId: str | None


class ScoreRevisionsChangedRead(_RealtimeEvent):
    schemaVersion: Literal[1]
    sequence: int = Field(ge=1, le=9007199254740991, strict=True)
    changeId: str = Field(min_length=1, strict=True)
    createdAt: Annotated[Instant, BeforeValidator(_date_time)]
    kind: Literal["score.revisions.changed"]
    scoreId: str = Field(min_length=1, strict=True)
    revisionId: str = Field(min_length=1, strict=True)


class ScoreDerivedAssetsChangedRead(_RealtimeEvent):
    schemaVersion: Literal[1]
    sequence: int = Field(ge=1, le=9007199254740991, strict=True)
    changeId: str = Field(min_length=1, strict=True)
    createdAt: Annotated[Instant, BeforeValidator(_date_time)]
    kind: Literal["score.derived_assets.changed"]
    scoreId: str = Field(min_length=1, strict=True)
    revisionId: str = Field(min_length=1, strict=True)


class ScoreMetadataChangedRead(_RealtimeEvent):
    schemaVersion: Literal[1]
    sequence: int = Field(ge=1, le=9007199254740991, strict=True)
    changeId: str = Field(min_length=1, strict=True)
    createdAt: Annotated[Instant, BeforeValidator(_date_time)]
    kind: Literal["score.metadata.changed"]
    scoreId: str = Field(min_length=1, strict=True)
    revisionId: str = Field(min_length=1, strict=True)


class ImportJobsChangedRead(_RealtimeEvent):
    schemaVersion: Literal[1]
    sequence: int = Field(ge=1, le=9007199254740991, strict=True)
    changeId: str = Field(min_length=1, strict=True)
    createdAt: Annotated[Instant, BeforeValidator(_date_time)]
    kind: Literal["import_jobs.changed"]
    importJobId: str = Field(min_length=1, strict=True)


RealtimeChangeRead = Annotated[
    NotificationsChangedRead
    | ScoreRevisionsChangedRead
    | ScoreDerivedAssetsChangedRead
    | ScoreMetadataChangedRead
    | ImportJobsChangedRead,
    Field(discriminator="kind"),
]
change_read_adapter: TypeAdapter[RealtimeChangeRead] = TypeAdapter(RealtimeChangeRead)

ResyncReason = Literal["retention_gap", "cursor_out_of_range", "invalid_cursor"]
