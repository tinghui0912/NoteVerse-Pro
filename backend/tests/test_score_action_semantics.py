"""Actions and access roles form separate, exhaustive capability semantics."""

from typing import get_args

import pytest

from app.core.exceptions import UnauthorizedException
from app.db.models import Score
from app.db.models.score_access import AccessOrigin, MembershipRole
from app.modules.score_access.actions import (
    ScoreAction,
    ScoreCapabilityField,
    semantics_for,
    _SCORE_ACTION_SEMANTICS,
)
from app.modules.score_access.policy import ScoreAccessContext, ScoreAccessPolicy
from app.modules.score_access.roles import owner_capabilities, membership_capabilities
from app.modules.score_access.schemas import ScoreCapabilities
from app.shared.error_codes import CustomerErrorCode


def test_every_action_has_one_valid_capability_semantics():
    assert set(_SCORE_ACTION_SEMANTICS) == set(ScoreAction)
    assert set(get_args(ScoreCapabilityField)) == set(ScoreCapabilities.model_fields)
    assert all(
        semantics_for(action).capability in ScoreCapabilities.model_fields for action in ScoreAction
    )


@pytest.mark.parametrize(
    "action,field,denial",
    [
        (ScoreAction.VIEW, "can_view", CustomerErrorCode.NO_ACCESS),
        (ScoreAction.EDIT, "can_edit", CustomerErrorCode.NO_EDIT_ACCESS),
        (ScoreAction.DELETE, "can_delete", CustomerErrorCode.NO_DELETE_ACCESS),
        (ScoreAction.LEAVE, "can_leave", CustomerErrorCode.NO_ACCESS),
        (
            ScoreAction.MANAGE_GUEST_PREVIEWS,
            "can_manage_guest_previews",
            CustomerErrorCode.NO_GUEST_PREVIEW_ACCESS,
        ),
        (ScoreAction.MANAGE_MEMBERS, "can_manage_members", CustomerErrorCode.NO_ACCESS),
        (ScoreAction.DOWNLOAD, "can_download", CustomerErrorCode.NO_DOWNLOAD_ACCESS),
        (ScoreAction.PRACTICE, "can_practice", CustomerErrorCode.NO_PRACTICE_ACCESS),
    ],
)
def test_action_consumes_its_exact_capability_and_denial(action, field, denial):
    spec = semantics_for(action)
    assert spec.capability == field
    assert spec.denial_code is denial
    score = Score(score_uuid="semantic-score", owner_user_id=1, display_title="Score")
    for allowed in (True, False):
        # Only the required capability has the requested value; all others differ.
        caps = ScoreCapabilities(
            **{
                name: allowed if name == field else not allowed
                for name in ScoreCapabilities.model_fields
            }
        )
        access = ScoreAccessContext(score, AccessOrigin.OWNER, caps)
        if allowed:
            ScoreAccessPolicy._require_action(access, score.score_uuid, action)
        else:
            with pytest.raises(UnauthorizedException) as denied:
                ScoreAccessPolicy._require_action(access, score.score_uuid, action)
            assert denied.value.code is denial


@pytest.mark.parametrize("role", [None, *MembershipRole])
def test_owner_and_membership_delete_leave_semantics(role):
    caps = owner_capabilities() if role is None else membership_capabilities(role)
    assert getattr(caps, semantics_for(ScoreAction.DELETE).capability) is (role is None)
    assert getattr(caps, semantics_for(ScoreAction.LEAVE).capability) is (role is not None)
