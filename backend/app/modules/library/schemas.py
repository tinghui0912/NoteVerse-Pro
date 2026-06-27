from __future__ import annotations

from datetime import datetime
from enum import Enum

from pydantic import BaseModel, Field, field_validator

from app.db.models import LibraryEntrySourceType, LibraryPracticeState, ScoreState
from app.modules.metadata.schemas import MetadataRead
from app.modules.scores.schemas import ScoreTaxonomyTagRead


class LibraryView(str, Enum):
    ALL = "all"
    FAVORITES = "favorites"
    RECENT_PRACTICE = "recent_practice"
    TO_PRACTICE = "to_practice"
    MASTERED = "mastered"
    BOOKMARKS = "bookmarks"
    TRASH = "trash"


class LibrarySort(str, Enum):
    UPDATED_DESC = "updated_desc"
    UPDATED_ASC = "updated_asc"
    NAME_ASC = "name_asc"
    NAME_DESC = "name_desc"
    PRACTICED_DESC = "practiced_desc"


class FolderDeleteMode(str, Enum):
    MOVE_CONTENTS_TO_PARENT = "MOVE_CONTENTS_TO_PARENT"
    MOVE_CONTENTS_TO_ROOT = "MOVE_CONTENTS_TO_ROOT"
    TRASH_CONTENTS = "TRASH_CONTENTS"


class LibraryFolderCreateRequest(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    parent_folder_id: str | None = None

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str) -> str:
        return value.strip()


class LibraryFolderUpdateRequest(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    parent_folder_id: str | None = None
    position: int | None = Field(default=None, ge=0)

    @field_validator("name")
    @classmethod
    def normalize_name(cls, value: str | None) -> str | None:
        return value.strip() if value is not None else None


class LibraryFolderDeleteRequest(BaseModel):
    mode: FolderDeleteMode = FolderDeleteMode.MOVE_CONTENTS_TO_PARENT


class LibraryEntryBatchMoveRequest(BaseModel):
    entry_ids: list[str] = Field(min_length=1)
    target_folder_id: str | None = None


class LibraryEntryBatchUpdateRequest(BaseModel):
    entry_ids: list[str] = Field(min_length=1)


class LibraryEntryBatchPracticeStateRequest(BaseModel):
    entry_ids: list[str] = Field(min_length=1)
    practice_state: LibraryPracticeState

    @field_validator("practice_state")
    @classmethod
    def reject_system_practice_state(
        cls, value: LibraryPracticeState
    ) -> LibraryPracticeState:
        if value == LibraryPracticeState.IN_PROGRESS:
            raise ValueError("IN_PROGRESS is managed by practice activity")
        return value


class LibraryEntryUpdateRequest(BaseModel):
    practice_state: LibraryPracticeState | None = None
    is_favorite: bool | None = None

    @field_validator("practice_state")
    @classmethod
    def reject_system_practice_state(
        cls, value: LibraryPracticeState | None
    ) -> LibraryPracticeState | None:
        if value == LibraryPracticeState.IN_PROGRESS:
            raise ValueError("IN_PROGRESS is managed by practice activity")
        return value


class LibraryFolderRead(BaseModel):
    folder_id: str
    parent_folder_id: str | None
    name: str
    position: int
    direct_count: int
    recursive_count: int
    created_at: datetime
    updated_at: datetime


class LibraryFolderTreeRead(BaseModel):
    all_count: int
    favorite_count: int
    recent_practice_count: int
    to_practice_count: int
    mastered_count: int
    folders: list[LibraryFolderRead]


class LibraryEntryRead(BaseModel):
    entry_id: str
    score_id: str
    source_type: LibraryEntrySourceType
    folder_id: str | None
    title: str
    score_state: ScoreState
    thumbnail_artifact_id: str | None
    taxonomy_tags: list[ScoreTaxonomyTagRead]
    metadata: MetadataRead | None
    is_favorite: bool
    practice_state: LibraryPracticeState
    available: bool
    unavailable_reason: str | None
    last_practiced_at: datetime | None
    created_at: datetime
    updated_at: datetime


