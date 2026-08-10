"""Synchronous database access settings for Worker tasks."""

from pydantic import BaseModel


class WorkerDatabaseSettings(BaseModel):
    SYNC_DATABASE_URL: str
