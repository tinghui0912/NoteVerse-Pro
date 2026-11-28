"""Collaboration invitation admission policy."""

from pydantic import BaseModel, Field


class CollaborationSettings(BaseModel):
    SCORE_INVITE_TTL_DAYS: int = Field(default=7, gt=0)
