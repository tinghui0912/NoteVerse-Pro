from __future__ import annotations


from app.shared.time import Instant

from pydantic import BaseModel, ConfigDict, Field

from app.modules.metadata.schemas import MetadataRead
from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.score_assets.schemas import ScoreDerivedAssetsRead
from app.modules.scores.genres import Genres
from app.shared.api_model import ApiModel


class ScoreUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    display_title: str | None = Field(default=None, min_length=1, max_length=255)
    genres: Genres | None = None
    expected_metadata_version: int = Field(ge=1)


class ScoreBatchDeleteRequest(BaseModel):
    score_ids: list[str] = Field(min_length=1)


class ScoreInputAssetRead(BaseModel):
    asset_id: str
    filename: str
    mime_type: str
    size: int
    page_number: int | None


class ScoreRead(ApiModel):
    score_id: str
    display_title: str
    genres: Genres
    metadata_version: int
    head_revision_id: str | None
    head_revision_number: int | None
    derived_assets: ScoreDerivedAssetsRead
    input_assets: list[ScoreInputAssetRead]
    metadata: MetadataRead | None
    capabilities: ScoreCapabilities
    created_at: Instant
    updated_at: Instant


class ScoreBatchDeleteRead(ApiModel):
    removed: int
