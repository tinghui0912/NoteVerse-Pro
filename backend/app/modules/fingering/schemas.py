"""API contracts for interactive fingering generation."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class FingeringRequest(BaseModel):
    content: str = Field(min_length=1)
    hand_size: Literal["XXS", "XS", "S", "M", "L", "XL", "XXL"] = "M"


class FingeringResultRead(BaseModel):
    content: str
