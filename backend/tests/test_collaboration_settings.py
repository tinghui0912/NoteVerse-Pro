import pytest
from pydantic import ValidationError
from app.platform.config.collaboration import CollaborationSettings


def test_default_invite_validity_is_seven_days():
    assert CollaborationSettings().SCORE_INVITE_TTL_DAYS == 7


@pytest.mark.parametrize("days", [0, -1])
def test_invite_validity_requires_positive_days(days):
    with pytest.raises(ValidationError):
        CollaborationSettings(SCORE_INVITE_TTL_DAYS=days)
