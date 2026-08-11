from __future__ import annotations

from datetime import datetime, timedelta

from app.db.models import ScoreInvite, User
from app.db.models.score_access import InviteStatus, MembershipRole
from app.modules.score_invites.rules import (
    can_user_accept_invite,
    display_invite_status,
    hash_invite_token,
    invite_role_label,
)


def _invite(*, status: InviteStatus, expires_at: datetime | None = None) -> ScoreInvite:
    return ScoreInvite(
        score_id=1,
        invite_uuid="invite-1",
        token_hash="hash",
        email="target@example.com",
        role=MembershipRole.EDITOR,
        status=status,
        created_by_user_id=2,
        expires_at=expires_at,
    )


def test_invite_token_hash_is_sha256_without_plaintext_token() -> None:
    token = "opaque-token"

    digest = hash_invite_token(token)

    assert len(digest) == 64
    assert digest != token
    assert digest == hash_invite_token(token)


def test_display_status_treats_expired_pending_invites_as_expired() -> None:
    now = datetime(2026, 8, 11, 8, 0, 0)

    assert (
        display_invite_status(
            _invite(status=InviteStatus.PENDING, expires_at=now - timedelta(seconds=1)),
            now=now,
        )
        == InviteStatus.EXPIRED
    )
    assert (
        display_invite_status(
            _invite(status=InviteStatus.PENDING, expires_at=now + timedelta(seconds=1)),
            now=now,
        )
        == InviteStatus.PENDING
    )
    assert (
        display_invite_status(
            _invite(status=InviteStatus.REVOKED, expires_at=now - timedelta(days=1)),
            now=now,
        )
        == InviteStatus.REVOKED
    )


def test_only_matching_user_can_accept_pending_invite() -> None:
    user = User(id=7, email="target@example.com")

    assert can_user_accept_invite(_invite(status=InviteStatus.PENDING), user) is True
    assert can_user_accept_invite(_invite(status=InviteStatus.PENDING), None) is False
    assert (
        can_user_accept_invite(
            _invite(status=InviteStatus.PENDING),
            User(id=8, email="other@example.com"),
        )
        is False
    )
    assert can_user_accept_invite(_invite(status=InviteStatus.ACCEPTED), user) is False


def test_invite_role_label_is_locale_specific() -> None:
    assert invite_role_label(MembershipRole.EDITOR, "en") == "Can edit"
    assert invite_role_label(MembershipRole.VIEWER, "en") == "View only"
    assert invite_role_label(MembershipRole.EDITOR, "zh") == "可编辑"
    assert invite_role_label(MembershipRole.VIEWER, "zh") == "仅查看"
