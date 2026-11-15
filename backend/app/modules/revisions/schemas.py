from __future__ import annotations


from app.shared.time import Instant

from pydantic import BaseModel, ConfigDict, Field

from app.db.models.score import RevisionOrigin
from app.shared.pagination import CursorPage
from app.shared.api_model import ApiModel


class RevisionCreateRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    content: str = Field(min_length=1)
    expected_head_revision_id: str
    idempotency_key: str | None = Field(default=None, min_length=8, max_length=128)
    origin: RevisionOrigin = RevisionOrigin.EDIT


class RevisionActorRead(BaseModel):
    display_name: str | None
    email: str
    avatar_url: str | None


class RevisionRestoreRequest(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class RevisionRestoreRead(BaseModel):
    restored_from_revision_id: str | None
    restored_from_revision_number: int | None
    note: str | None
    actor: RevisionActorRead | None
    created_at: Instant


class RevisionNoteUpdateRequest(BaseModel):
    note: str | None = Field(default=None, max_length=500)


class RevisionNoteRead(BaseModel):
    note: str
    author: RevisionActorRead | None
    updated_at: Instant


class RevisionRead(ApiModel):
    revision_id: str
    revision_number: int
    origin: RevisionOrigin
    created_at: Instant
    created_by: RevisionActorRead | None
    restore: RevisionRestoreRead | None
    note: RevisionNoteRead | None


class RevisionListRead(CursorPage[RevisionRead]):
    pass


class RevisionContentRead(RevisionRead):
    content: str
    mime_type: str
