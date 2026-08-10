"""PostgreSQL advisory-lock settings for the Beat leader."""

from pydantic import BaseModel, field_validator


class BeatSchedulerSettings(BaseModel):
    SCHEDULER_LOCK_DATABASE_URL: str
    SCHEDULER_LOCK_CONNECT_TIMEOUT_SECONDS: int = 5
    SCHEDULER_LOCK_KEEPALIVES_IDLE_SECONDS: int = 30
    SCHEDULER_LOCK_KEEPALIVES_INTERVAL_SECONDS: int = 10
    SCHEDULER_LOCK_KEEPALIVES_COUNT: int = 3
    SCHEDULER_LOCK_STATEMENT_TIMEOUT_MILLISECONDS: int = 5000
    SCHEDULER_LOCK_TCP_USER_TIMEOUT_MILLISECONDS: int = 30000
    SCHEDULER_LEADER_RETRY_INTERVAL_SECONDS: int = 5
    SCHEDULER_LEADER_HEARTBEAT_INTERVAL_SECONDS: int = 15

    @field_validator("SCHEDULER_LOCK_DATABASE_URL")
    @classmethod
    def validate_scheduler_lock_database_url(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized.startswith(("postgresql://", "postgresql+psycopg://")):
            raise ValueError("SCHEDULER_LOCK_DATABASE_URL must use a PostgreSQL psycopg-compatible URL")
        return normalized
