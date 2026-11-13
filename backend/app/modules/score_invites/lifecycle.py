"""Effective invitation lifecycle derives from optional actor outcome and expiry."""

from datetime import datetime
from enum import Enum

from app.core.exceptions import ValidationException
from app.db.models.score_access import ScoreInvite
from app.shared.constants import ErrorCode


class InviteStatus(str, Enum):
    PENDING = "PENDING"
    ACCEPTED = "ACCEPTED"
    DECLINED = "DECLINED"
    REVOKED = "REVOKED"
    EXPIRED = "EXPIRED"


def effective_invite_status(invite: ScoreInvite, *, now: datetime) -> InviteStatus:
    if invite.terminal_outcome is not None:
        return InviteStatus(invite.terminal_outcome.value)
    if invite.expires_at is not None and invite.expires_at <= now:
        return InviteStatus.EXPIRED
    return InviteStatus.PENDING


def require_pending_invite(invite: ScoreInvite, *, field: str, now: datetime) -> None:
    status = effective_invite_status(invite, now=now)
    if status == InviteStatus.PENDING:
        return
    code = {
        InviteStatus.EXPIRED: ErrorCode.INVITE_EXPIRED,
        InviteStatus.REVOKED: ErrorCode.INVITE_REVOKED,
        InviteStatus.ACCEPTED: ErrorCode.INVITE_ALREADY_ACCEPTED,
        InviteStatus.DECLINED: ErrorCode.INVITE_DECLINED,
    }[status]
    raise ValidationException(code, field=field)
