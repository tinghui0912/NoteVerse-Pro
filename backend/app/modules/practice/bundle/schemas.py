from __future__ import annotations

from typing import Literal
from pydantic import BaseModel, ConfigDict
from app.modules.practice.score.generated import artifact_transport
from app.shared.api_model import ApiModel


class StrictPracticeBundleModel(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True, allow_inf_nan=False)


class PracticeBundleNotationRead(StrictPracticeBundleModel):
    musicxml: str
    mime_type: Literal["application/vnd.recordare.musicxml+xml"] = (
        "application/vnd.recordare.musicxml+xml"
    )


class ScoreRevisionPracticeBindingRead(StrictPracticeBundleModel):
    score_id: str
    revision_id: str
    bundle_id: str


class PracticeBundleRead(ApiModel, StrictPracticeBundleModel):
    binding: ScoreRevisionPracticeBindingRead
    artifact: artifact_transport.PracticeScoreArtifactRead
    notation: PracticeBundleNotationRead | None
