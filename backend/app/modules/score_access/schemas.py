from pydantic import BaseModel

from app.db.models.score_access import AccessOrigin


class ScoreCapabilities(BaseModel):
    can_view: bool
    can_edit: bool
    can_delete: bool
    can_manage_sharing: bool
    can_manage_members: bool
    can_download: bool
    can_practice: bool
    can_publish: bool


class ScoreAccessRead(BaseModel):
    origin: AccessOrigin
    score_id: str
    revision_id: str
    capabilities: ScoreCapabilities
