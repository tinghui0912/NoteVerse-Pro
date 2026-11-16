"""Membership strength and Score capabilities share one semantic authority."""

from dataclasses import dataclass

from app.db.models.score_access import MembershipRole
from app.modules.score_access.schemas import ScoreCapabilities


@dataclass(frozen=True)
class _RoleSemantics:
    rank: int
    edit: bool
    practice: bool


_ROLES = {
    MembershipRole.VIEWER: _RoleSemantics(1, False, False),
    MembershipRole.PRACTITIONER: _RoleSemantics(2, False, True),
    MembershipRole.EDITOR: _RoleSemantics(3, True, True),
}


def stronger_role(existing: MembershipRole, invited: MembershipRole) -> MembershipRole:
    return invited if _ROLES[invited].rank > _ROLES[existing].rank else existing


def membership_capabilities(role: MembershipRole) -> ScoreCapabilities:
    semantics = _ROLES[role]
    return ScoreCapabilities(
        can_view=True,
        can_edit=semantics.edit,
        can_delete=False,
        can_leave=True,
        can_manage_guest_previews=False,
        can_manage_members=False,
        can_download=False,
        can_practice=semantics.practice,
    )


def owner_capabilities() -> ScoreCapabilities:
    return ScoreCapabilities(
        can_view=True,
        can_edit=True,
        can_delete=True,
        can_leave=False,
        can_manage_guest_previews=True,
        can_manage_members=True,
        can_download=True,
        can_practice=True,
    )
