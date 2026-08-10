import pytest
from pydantic import ValidationError

from app.core.settings.beat_scheduler import BeatSchedulerSettings


def test_beat_scheduler_settings_accept_postgresql_leader_contract() -> None:
    settings = BeatSchedulerSettings(
        SCHEDULER_LOCK_DATABASE_URL="postgresql+psycopg://user:password@db/noteverse"
    )

    assert settings.SCHEDULER_LEADER_HEARTBEAT_INTERVAL_SECONDS == 15


@pytest.mark.parametrize(
    "field",
    (
        "SCHEDULER_LOCK_CONNECT_TIMEOUT_SECONDS",
        "SCHEDULER_LOCK_KEEPALIVES_IDLE_SECONDS",
        "SCHEDULER_LOCK_KEEPALIVES_INTERVAL_SECONDS",
        "SCHEDULER_LOCK_KEEPALIVES_COUNT",
        "SCHEDULER_LOCK_STATEMENT_TIMEOUT_MILLISECONDS",
        "SCHEDULER_LOCK_TCP_USER_TIMEOUT_MILLISECONDS",
        "SCHEDULER_LEADER_RETRY_INTERVAL_SECONDS",
        "SCHEDULER_LEADER_HEARTBEAT_INTERVAL_SECONDS",
    ),
)
def test_beat_scheduler_settings_reject_non_positive_timing_values(field: str) -> None:
    values = {"SCHEDULER_LOCK_DATABASE_URL": "postgresql://user:password@db/noteverse"}
    values[field] = 0

    with pytest.raises(ValidationError, match=field):
        BeatSchedulerSettings(**values)
