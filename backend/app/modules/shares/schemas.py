from __future__ import annotations

from datetime import datetime
from typing import Optional, TypedDict

from pydantic import BaseModel, ConfigDict

from app.modules.tasks.schemas import TaskStatusResult


class ShareBase(BaseModel):
    can_download: Optional[bool] = False
    can_edit: Optional[bool] = False
    expires_at: Optional[datetime] = None


class CreateShareRequest(BaseModel):
    task_id: str
    expires_in_days: Optional[int] = 7


class SaveShareRequest(BaseModel):
    token: str


class BatchDeleteSavedSharesRequest(BaseModel):
    ids: list[int]


class ShareListItem(TypedDict):
    id: int | None
    share_token: str
    task_id: str | None
    expires_at: str | None
    can_download: bool
    can_edit: bool
    revoked_at: str | None
    created_at: str | None


class ShareListResponse(TypedDict):
    shares: list[ShareListItem]
    total: int
    page: int
    page_size: int


class ShareCreateResult(TypedDict):
    share_token: str
    expires_at: str


class ShareRevokeResult(TypedDict):
    share_token: str
    revoked: bool
    revoked_at: str | None


class SavedShareListItem(TypedDict):
    id: int | None
    share_token: str
    task_id: str
    task_title: str
    task_state: str
    thumbnail_type: str | None
    shared_by: str
    created_at: str | None


class SavedShareListResult(TypedDict):
    items: list[SavedShareListItem]
    total: int


class ShareAccessInfo(TypedDict):
    shared_by: str
    expires_at: str | None
    can_download: bool
    can_edit: bool


class ShareAccessResult(TypedDict):
    task: TaskStatusResult
    share_info: ShareAccessInfo


class ShareDownloadFileItem(TypedDict):
    path: str
    page: int | None
    mime_type: str | None


class ShareCreate(ShareBase):
    task_id: str
    expires: Optional[str] = "7d"


class Share(ShareBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    token: str
    url: Optional[str] = None
    revoked_at: Optional[datetime] = None
    created_at: datetime
    task_id: int
    owner_user_id: int


class SavedShareBase(BaseModel):
    note: Optional[str] = None


class SavedShareCreate(SavedShareBase):
    token: str


class SavedShare(SavedShareBase):
    model_config = ConfigDict(from_attributes=True)

    id: int
    user_id: int
    share_id: int
    created_at: datetime
