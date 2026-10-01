from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel

from app.db.models.score_access import ScoreAudienceAccessMode
from app.modules.metadata.schemas import MetadataRead
from app.modules.score_access.schemas import ScoreCapabilities
from app.modules.score_assets.schemas import ScoreDerivedAssetsRead, ScoreRevisionAssetsRead
from app.modules.scores.schemas import ScoreTaxonomyTagRead


class GrantCreateRequest(BaseModel):
    access_mode: ScoreAudienceAccessMode = ScoreAudienceAccessMode.PRACTICE
    allow_download: bool = False
    expires_at: datetime | None = None


class GrantCreatedRead(BaseModel):
    grant_id: str
    token: str
    access_mode: ScoreAudienceAccessMode
    allow_download: bool
    expires_at: datetime | None
    created_at: datetime


class GrantRead(BaseModel):
    grant_id: str
    token: str | None = None
    access_mode: ScoreAudienceAccessMode
    allow_download: bool
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
    derived_assets: ScoreDerivedAssetsRead
    revision_assets: ScoreRevisionAssetsRead


class GrantBookmarkRead(BaseModel):
    entry_id: str
    score_id: str
    title: str
    available: bool
    unavailable_reason: str | None
    created_at: datetime


class GrantRedeemRead(BaseModel):
    score_id: str
    title: str
    can_practice: bool
