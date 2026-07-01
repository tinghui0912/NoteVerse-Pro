from pydantic import BaseModel

from app.db.models.score_access import AccessOrigin


class ScoreCapabilities(BaseModel):
    can_view: bool = False
    can_edit: bool = False
    can_delete: bool = False
    can_manage_sharing: bool = False
    can_manage_members: bool = False
    can_download: bool = False
    can_practice: bool = False
    can_publish: bool = False
    can_approve: bool = False


class ScoreAccessRead(BaseModel):
    origin: AccessOrigin
    score_id: str
    revision_id: str
    capabilities: ScoreCapabilities
