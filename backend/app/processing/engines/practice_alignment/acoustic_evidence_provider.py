"""Benchmark acoustic evidence provider contract for score-conditioned practice."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

from app.processing.engines.practice_alignment.score_timeline import (
    ExpectedPracticeGroup,
    ScoreBeat,
)


@dataclass(frozen=True)
class AcousticEvidenceProviderDescriptor:
    provider_id: str
    benchmark_only: bool
    output_semantics: str
    metadata: dict[str, Any] = field(default_factory=dict)


class AcousticEvidenceProvider(Protocol):
    """Produces expected-pitch evidence without making product match decisions."""

    descriptor: AcousticEvidenceProviderDescriptor

    def observe_expected_group(
        self,
        samples,
        *,
        expected_group: ExpectedPracticeGroup,
        sample_rate: int,
        np_module,
        onset_beat: ScoreBeat | None = None,
        window_start_seconds: float | None = None,
        window_end_seconds: float | None = None,
    ) -> Any:
        """Return expected-pitch activations for the current practice target."""
