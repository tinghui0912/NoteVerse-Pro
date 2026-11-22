"""Score actions bind one required capability to one public denial code."""

from dataclasses import dataclass
from enum import Enum
from types import MappingProxyType
from typing import Literal, Mapping

from app.modules.score_access.schemas import ScoreCapabilities
from app.shared.error_codes import CustomerErrorCode


class ScoreAction(str, Enum):
    VIEW = "VIEW"
    EDIT = "EDIT"
    DELETE = "DELETE"
    LEAVE = "LEAVE"
    MANAGE_GUEST_PREVIEWS = "MANAGE_GUEST_PREVIEWS"
    MANAGE_MEMBERS = "MANAGE_MEMBERS"
    DOWNLOAD = "DOWNLOAD"
    PRACTICE = "PRACTICE"


ScoreCapabilityField = Literal[
    "can_view",
    "can_edit",
    "can_delete",
    "can_leave",
    "can_manage_guest_previews",
    "can_manage_members",
    "can_download",
    "can_practice",
]


@dataclass(frozen=True)
class ScoreActionSemantics:
    capability: ScoreCapabilityField
    denial_code: CustomerErrorCode


_SCORE_ACTION_SEMANTICS: Mapping[ScoreAction, ScoreActionSemantics] = MappingProxyType(
    {
        ScoreAction.VIEW: ScoreActionSemantics("can_view", CustomerErrorCode.NO_ACCESS),
        ScoreAction.EDIT: ScoreActionSemantics("can_edit", CustomerErrorCode.NO_EDIT_ACCESS),
        ScoreAction.DELETE: ScoreActionSemantics("can_delete", CustomerErrorCode.NO_DELETE_ACCESS),
        ScoreAction.LEAVE: ScoreActionSemantics("can_leave", CustomerErrorCode.NO_ACCESS),
        ScoreAction.MANAGE_GUEST_PREVIEWS: ScoreActionSemantics(
            "can_manage_guest_previews", CustomerErrorCode.NO_GUEST_PREVIEW_ACCESS
        ),
        ScoreAction.MANAGE_MEMBERS: ScoreActionSemantics(
            "can_manage_members", CustomerErrorCode.NO_ACCESS
        ),
        ScoreAction.DOWNLOAD: ScoreActionSemantics(
            "can_download", CustomerErrorCode.NO_DOWNLOAD_ACCESS
        ),
        ScoreAction.PRACTICE: ScoreActionSemantics(
            "can_practice", CustomerErrorCode.NO_PRACTICE_ACCESS
        ),
    }
)

if set(_SCORE_ACTION_SEMANTICS) != set(ScoreAction) or any(
    spec.capability not in ScoreCapabilities.model_fields
    for spec in _SCORE_ACTION_SEMANTICS.values()
):
    raise RuntimeError("Every Score action requires valid, explicit capability semantics")


def semantics_for(action: ScoreAction) -> ScoreActionSemantics:
    return _SCORE_ACTION_SEMANTICS[action]
