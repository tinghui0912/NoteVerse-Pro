from __future__ import annotations

import hashlib
import secrets
from datetime import datetime

from app.db.models import ScoreInvite, User
from app.db.models.score_access import MembershipRole
from app.modules.score_invites.lifecycle import InviteStatus, effective_invite_status


ROLE_RANK: dict[MembershipRole, int] = {
    MembershipRole.VIEWER: 1,
    MembershipRole.PRACTITIONER: 2,
    MembershipRole.EDITOR: 3,
}

INVITE_TOKEN_BYTES = 32


def hash_invite_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_invite_token() -> str:
    return secrets.token_urlsafe(INVITE_TOKEN_BYTES)


def can_user_accept_invite(invite: ScoreInvite, user: User | None, *, now: datetime) -> bool:
    if user is None:
        return False
    if effective_invite_status(invite, now=now) != InviteStatus.PENDING:
        return False
    return invite.email == user.email.lower()


def invite_role_label(role: MembershipRole, locale: str) -> str:
    labels = {
        "en": {
            MembershipRole.VIEWER: "Can view",
            MembershipRole.PRACTITIONER: "Can practice",
            MembershipRole.EDITOR: "Can edit",
        },
        "zh": {
            MembershipRole.VIEWER: "可查看",
            MembershipRole.PRACTITIONER: "可练习",
            MembershipRole.EDITOR: "可编辑",
        },
    }
    return labels["en" if locale == "en" else "zh"][role]
