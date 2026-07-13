from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.db.models.score_access import PublicationStatus
from app.modules.metadata.schemas import MetadataRead
from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.score_assets.schemas import ScoreRevisionAssetsRead
from app.modules.scores.schemas import ScoreDerivedAssetsRead, ScoreTaxonomyTagRead


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
    derived_assets: ScoreDerivedAssetsRead
    revision_assets: ScoreRevisionAssetsRead
    capabilities: ScoreCapabilities
