from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.artifacts.schemas import ArtifactRead
from app.modules.metadata.schemas import MetadataRead
from app.modules.scores.schemas import ScoreTaxonomyTagRead


class GrantCreateRequest(BaseModel):
    allow_download: bool = True
    allow_practice: bool = True
    expires_at: datetime | None = None


class GrantCreatedRead(BaseModel):
    grant_id: str
    token: str
    allow_download: bool
    allow_practice: bool
    expires_at: datetime | None
    created_at: datetime


class GrantRead(BaseModel):
    grant_id: str
    token: str | None = None
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


class GrantBookmarkRead(BaseModel):
    entry_id: str
    score_id: str
    title: str
    available: bool
    unavailable_reason: str | None
    created_at: datetime
