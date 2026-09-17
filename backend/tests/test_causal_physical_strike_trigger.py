from __future__ import annotations

import sys
from pathlib import Path

import numpy as np


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from evaluate_causal_physical_strike_trigger import (  # noqa: E402
    CausalPcmStrikeDetector,
    DetectorConfig,
    SAMPLE_RATE,
    _chunk_ranges,
)


def _run(audio: np.ndarray, chunk_spec: str) -> tuple[tuple[int, int], ...]:
    detector = CausalPcmStrikeDetector(
        DetectorConfig(min_rms=0.002, min_flux=0.02, refractory_samples=800)
    )
    for start, end in _chunk_ranges(int(audio.size), chunk_spec=chunk_spec):
        detector.ingest(audio[start:end])
    return tuple(
        (candidate.candidate_anchor_sample, candidate.candidate_emit_sample)
        for candidate in detector.candidates
    )


def test_detector_candidates_are_chunk_partition_invariant() -> None:
    audio = np.zeros(SAMPLE_RATE, dtype=np.float32)
    audio[4_000:4_080] = np.hanning(80).astype(np.float32) * 0.35
    audio[9_100:9_180] = np.hanning(80).astype(np.float32) * 0.3

    reference = _run(audio, "640")

    assert reference
    assert _run(audio, "683") == reference
    assert _run(audio, "743") == reference
    assert _run(audio, "irregular") == reference


def test_detector_never_emits_before_samples_are_received() -> None:
    audio = np.zeros(SAMPLE_RATE // 2, dtype=np.float32)
    audio[2_000:2_080] = 0.4
    detector = CausalPcmStrikeDetector(
        DetectorConfig(min_rms=0.002, min_flux=0.02, refractory_samples=800)
    )

    for start, end in _chunk_ranges(int(audio.size), chunk_spec="317"):
        emitted = detector.ingest(audio[start:end])
        for candidate in emitted:
            assert candidate.candidate_anchor_sample <= candidate.candidate_emit_sample
            assert candidate.candidate_emit_sample <= candidate.received_samples_at_emit
            assert candidate.received_samples_at_emit == detector.received_samples


def test_detector_does_not_use_pitch_or_target_metadata() -> None:
    detector = CausalPcmStrikeDetector()

    assert not hasattr(detector, "target_group_seconds")
    assert not hasattr(detector, "expected_pitches")
    assert not hasattr(detector, "case_kind")
