from __future__ import annotations


from app.shared.time import Instant
from enum import Enum

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.db.models.score_access import AccessOrigin
from app.modules.metadata.schemas import MetadataRead
from app.modules.score_assets.schemas import ScoreDerivedAssetsRead
from app.modules.scores.genres import Genres
from app.shared.api_model import ApiModel


class LibraryView(str, Enum):
    ALL = "all"
    FAVORITES = "favorites"
    CREATED_BY_ME = "created_by_me"
    SHARED_WITH_ME = "shared_with_me"


class LibrarySort(str, Enum):
    UPDATED_DESC = "updated_desc"
    UPDATED_ASC = "updated_asc"
    NAME_ASC = "name_asc"
    NAME_DESC = "name_desc"


class LibraryFolderCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(min_length=1, max_length=255)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        value = value.strip()
        if not value:
            raise ValueError("folder name must not be blank")
        return value


class LibraryFolderUpdateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=255)
    position: int | None = Field(default=None, ge=0)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        if value is not None:
            value = value.strip()
            if not value:
                raise ValueError("folder name must not be blank")
        return value


class LibraryScoreBatchMoveRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    score_ids: list[str] = Field(min_length=1)
    target_folder_id: str | None = None


class LibraryScoreBatchFavoriteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    score_ids: list[str] = Field(min_length=1)
    is_favorite: bool


class LibraryBatchMoveRead(ApiModel):
    moved: int


class LibraryBatchUpdateRead(ApiModel):
    updated: int


class LibraryFolderRead(ApiModel):
    folder_id: str
    name: str
    position: int
    score_count: int
    created_at: Instant
    updated_at: Instant


class LibraryFolderOverviewRead(ApiModel):
    all_count: int
    favorite_count: int
    created_by_me_count: int
    shared_with_me_count: int
    folders: list[LibraryFolderRead]


class LibraryScoreRead(ApiModel):
    score_id: str
    access_origin: AccessOrigin
    folder_id: str | None
    display_title: str
    derived_assets: ScoreDerivedAssetsRead
    genres: Genres
    metadata: MetadataRead | None
    is_favorite: bool
    created_at: Instant
    updated_at: Instant
