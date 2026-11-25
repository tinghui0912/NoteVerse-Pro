"""Pure effective invitation projection, admission and recipient eligibility."""

from datetime import UTC


from datetime import datetime, timedelta
import pytest
from app.core.exceptions import ValidationException
from app.db.models import ScoreInvite, User
from app.db.models.score_access import InviteTerminalOutcome, MembershipRole
from app.modules.collaboration.invite_lifecycle import (
    InviteStatus,
    effective_invite_status,
    require_pending_invite,
)
from app.modules.collaboration.invite_lifecycle import (
    can_user_accept_invite,
    hash_invite_token,
)
from app.modules.mail.templates.score_invites import invite_role_label
from app.shared.error_codes import CustomerErrorCode

NOW = datetime(2026, 8, 11, 8, tzinfo=UTC)


def invite(*, outcome=None, expires_at=None):
    closed = outcome in {
        InviteTerminalOutcome.RECIPIENT_ACCOUNT_CLOSED,
        InviteTerminalOutcome.INVITER_ACCOUNT_CLOSED,
    }
    return ScoreInvite(
        score_id=1,
        invite_uuid="invite-1",
        token_hash=None if closed else "hash",
        email=None if closed else "target@example.com",
        role=MembershipRole.EDITOR,
        created_by_user_id=None if outcome == InviteTerminalOutcome.INVITER_ACCOUNT_CLOSED else 2,
        terminal_outcome=outcome,
        terminal_at=NOW if outcome else None,
        terminal_actor_user_id=2
        if outcome
        in {
            InviteTerminalOutcome.ACCEPTED,
            InviteTerminalOutcome.DECLINED,
            InviteTerminalOutcome.REVOKED,
        }
        else None,
        expires_at=expires_at,
    )


def test_invite_token_hash_is_sha256_without_plaintext_token():
    digest = hash_invite_token("opaque-token")
    assert len(digest) == 64 and digest != "opaque-token"
    assert digest == hash_invite_token("opaque-token")


@pytest.mark.parametrize(
    "expiry,expected",
    [
        (None, InviteStatus.PENDING),
        (NOW + timedelta(microseconds=1), InviteStatus.PENDING),
        (NOW, InviteStatus.EXPIRED),
        (NOW - timedelta(days=1), InviteStatus.EXPIRED),
    ],
)
def test_unresolved_effective_status_is_a_pure_time_projection(expiry, expected):
    row = invite(expires_at=expiry)
    assert effective_invite_status(row, now=NOW) == expected
    if expected == InviteStatus.PENDING:
        require_pending_invite(row, field="invite_id", now=NOW)
    else:
        with pytest.raises(ValidationException) as error:
            require_pending_invite(row, field="invite_id", now=NOW)
        assert error.value.code == CustomerErrorCode.INVITE_EXPIRED
    assert row.terminal_outcome is row.terminal_at is row.terminal_actor_user_id is None


@pytest.mark.parametrize("outcome", list(InviteTerminalOutcome))
def test_actor_terminal_outcome_wins_over_expiry(outcome):
    row = invite(outcome=outcome, expires_at=NOW - timedelta(days=1))
    assert effective_invite_status(row, now=NOW) == InviteStatus(outcome.value)
    with pytest.raises(ValidationException):
        require_pending_invite(row, field="invite_id", now=NOW)
    assert row.terminal_outcome == outcome


def test_only_matching_user_can_accept_an_unresolved_effectively_pending_invite():
    user = User(id=7, email="target@example.com")
    assert can_user_accept_invite(invite(), user, now=NOW)
    assert not can_user_accept_invite(invite(), None, now=NOW)
    assert not can_user_accept_invite(invite(), User(id=8, email="other@example.com"), now=NOW)
    assert not can_user_accept_invite(invite(outcome=InviteTerminalOutcome.ACCEPTED), user, now=NOW)
    assert not can_user_accept_invite(invite(expires_at=NOW), user, now=NOW)


def test_invite_role_label_is_locale_specific() -> None:
    assert invite_role_label(MembershipRole.EDITOR, "en") == "Can edit"
    assert invite_role_label(MembershipRole.VIEWER, "en") == "Can view"
    assert invite_role_label(MembershipRole.EDITOR, "zh") == "可编辑"
    assert invite_role_label(MembershipRole.VIEWER, "zh") == "可查看"

    assert invite_role_label(MembershipRole.PRACTITIONER, "en") == "Can practice"
    assert invite_role_label(MembershipRole.PRACTITIONER, "zh") == "可练习"
