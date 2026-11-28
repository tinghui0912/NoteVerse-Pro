"""API contracts for interactive fingering generation."""

from __future__ import annotations


from typing import Literal

from app.platform.document_admission.musicxml import MUSICXML_LIMITS

from pydantic import BaseModel, Field
from app.shared.api_model import ApiModel


class FingeringRequest(BaseModel):
    content: str = Field(min_length=1, max_length=MUSICXML_LIMITS.max_bytes)
    hand_size: Literal["XXS", "XS", "S", "M", "L", "XL", "XXL"] = "M"


class FingeringResultRead(ApiModel):
    content: str
