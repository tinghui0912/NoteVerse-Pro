from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from app.modules.metadata.schemas import MetadataRead
from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.score_assets.schemas import ScoreDerivedAssetsRead
from app.modules.scores.genres import Genres


class ScoreUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    title: str | None = Field(default=None, min_length=1, max_length=255)
    genres: Genres | None = None
    expected_version: int = Field(ge=1)


class ScoreBatchDeleteRequest(BaseModel):
    score_ids: list[str] = Field(min_length=1)


class ScoreInputAssetRead(BaseModel):
    asset_id: str
    filename: str
    mime_type: str
    size: int
    page_number: int | None


class ScoreRead(BaseModel):
    score_id: str
    title: str
    genres: Genres
    version: int
    head_revision_id: str | None
    derived_assets: ScoreDerivedAssetsRead
    input_assets: list[ScoreInputAssetRead]
    in_library: bool
    metadata: MetadataRead | None
    capabilities: ScoreCapabilities
    created_at: datetime
    updated_at: datetime
