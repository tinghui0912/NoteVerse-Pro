from datetime import datetime
from typing import Annotated, Literal
from pydantic import Field, TypeAdapter
from app.shared.api_model import ApiModel

REALTIME_CHANGE_SCHEMA_VERSION: Literal[1] = 1


class ChangeBaseRead(ApiModel):
    schemaVersion: Literal[1] = REALTIME_CHANGE_SCHEMA_VERSION
    sequence: int
    changeId: str
    createdAt: datetime


class NotificationsChangedRead(ChangeBaseRead):
    kind: Literal["notifications.changed"] = "notifications.changed"
    notificationId: str | None = None


class ScoreRevisionsChangedRead(ChangeBaseRead):
    kind: Literal["score.revisions.changed"] = "score.revisions.changed"
    scoreId: str
    revisionId: str


class ScoreDerivedAssetsChangedRead(ChangeBaseRead):
    kind: Literal["score.derived_assets.changed"] = "score.derived_assets.changed"
    scoreId: str
    revisionId: str


class ScoreMetadataChangedRead(ChangeBaseRead):
    kind: Literal["score.metadata.changed"] = "score.metadata.changed"
    scoreId: str
    revisionId: str


class ImportJobsChangedRead(ChangeBaseRead):
    kind: Literal["import_jobs.changed"] = "import_jobs.changed"
    importJobId: str


RealtimeChangeRead = Annotated[
    NotificationsChangedRead
    | ScoreRevisionsChangedRead
    | ScoreDerivedAssetsChangedRead
    | ScoreMetadataChangedRead
    | ImportJobsChangedRead,
    Field(discriminator="kind"),
]
change_read_adapter: TypeAdapter[RealtimeChangeRead] = TypeAdapter(RealtimeChangeRead)


class ResyncRequiredRead(ApiModel):
    schemaVersion: Literal[1] = REALTIME_CHANGE_SCHEMA_VERSION
    sequence: int
    reason: Literal["retention_gap", "cursor_out_of_range", "invalid_cursor"]
