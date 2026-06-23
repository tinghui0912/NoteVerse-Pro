from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, model_validator

from app.db.models.score_access import ShareTargetMode
from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.artifacts.schemas import ArtifactRead
from app.modules.metadata.schemas import MetadataRead
from app.modules.scores.schemas import ScoreTaxonomyTagRead


class GrantCreateRequest(BaseModel):
    target_mode: ShareTargetMode = ShareTargetMode.LATEST
    target_revision_id: str | None = None
    allow_download: bool = True
    allow_practice: bool = True
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def validate_target(self):
        if self.target_mode == ShareTargetMode.PINNED and not self.target_revision_id:
            raise ValueError("target_revision_id is required for PINNED grants")
        if self.target_mode == ShareTargetMode.LATEST and self.target_revision_id:
            raise ValueError("LATEST grants cannot specify target_revision_id")
        return self


class GrantCreatedRead(BaseModel):
    grant_id: str
    token: str
    target_mode: ShareTargetMode
    target_revision_id: str | None
    allow_download: bool
    allow_practice: bool
    expires_at: datetime | None
    created_at: datetime


class GrantRead(BaseModel):
    grant_id: str
    token: str | None = None
    target_mode: ShareTargetMode
    target_revision_id: str | None
    allow_download: bool
    allow_practice: bool
    expires_at: datetime | None
    revoked_at: datetime | None
    created_at: datetime


class ShareActorRead(BaseModel):
    display_name: str | None
    avatar_url: str | None


class GrantAccessRead(BaseModel):
    score_id: str
    revision_id: str
    title: str
    taxonomy_tags: list[ScoreTaxonomyTagRead]
    shared_by: ShareActorRead | None
    shared_at: datetime
    capabilities: ScoreCapabilities
    metadata: MetadataRead | None
    artifacts: list[ArtifactRead]


class GrantContentRead(BaseModel):
    score_id: str
    revision_id: str
    content: str
    mime_type: str


class BookmarkRead(BaseModel):
    bookmark_id: int
    score_id: str
    title: str
    available: bool
    unavailable_reason: str | None
    created_at: datetime


class BookmarkDeleteRequest(BaseModel):
    bookmark_ids: list[int] = Field(min_length=1)
