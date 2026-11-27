"""Consumer session lifetimes have bounded touch and cache policies."""

import pytest
from pydantic import ValidationError
from app.platform.config.customer_session_security import CustomerSessionSecuritySettings


def test_session_defaults():
    config = CustomerSessionSecuritySettings(AUTH_COOKIE_SECURE=False)
    assert config.SESSION_IDLE_DAYS == 14 and config.SESSION_ABSOLUTE_DAYS == 30
    assert config.SESSION_TOUCH_INTERVAL_SECONDS == 600
    assert config.SESSION_CACHE_TTL_SECONDS == 120


@pytest.mark.parametrize(
    "field,value",
    [
        ("SESSION_IDLE_DAYS", 0),
        ("SESSION_IDLE_DAYS", 15),
        ("SESSION_ABSOLUTE_DAYS", 0),
        ("SESSION_ABSOLUTE_DAYS", 31),
        ("SESSION_TOUCH_INTERVAL_SECONDS", 299),
        ("SESSION_TOUCH_INTERVAL_SECONDS", 901),
        ("SESSION_CACHE_TTL_SECONDS", 59),
        ("SESSION_CACHE_TTL_SECONDS", 181),
    ],
)
def test_session_settings_reject_unbounded_values(field, value):
    with pytest.raises(ValidationError):
        CustomerSessionSecuritySettings(AUTH_COOKIE_SECURE=False, **{field: value})
