from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.db.models.score_access import PublicationStatus
from app.modules.artifacts.schemas import ArtifactRead
from app.modules.metadata.schemas import MetadataRead
from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.scores.schemas import ScoreTaxonomyTagRead


class PublicationUpsertRequest(BaseModel):
    revision_id: str | None = None
    public_slug: str | None = Field(
        default=None, pattern=r"^[a-z0-9]+(?:-[a-z0-9]+)*$", max_length=128
    )
    allow_download: bool = False
    allow_practice: bool = True


class PublicationRead(BaseModel):
    public_slug: str
    score_id: str
    revision_id: str
    status: PublicationStatus
    allow_download: bool
    allow_practice: bool
    published_at: datetime
    updated_at: datetime


class PublicScoreRead(BaseModel):
    publication: PublicationRead
    title: str
    taxonomy_tags: list[ScoreTaxonomyTagRead]
    metadata: MetadataRead | None
    artifacts: list[ArtifactRead]
    capabilities: ScoreCapabilities


class PublicScoreContentRead(BaseModel):
    score_id: str
    revision_id: str
    content: str
    mime_type: str
