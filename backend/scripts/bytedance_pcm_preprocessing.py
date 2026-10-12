"""Shared research-only ByteDance PCM preprocessing helpers."""

from __future__ import annotations

import numpy as np


def extract_resample_linear(
    source: np.ndarray,
    source_rate: int,
    start_ms: float,
    end_ms: float,
    output_samples: int,
) -> np.ndarray:
    """Extract a source-time window and linearly resample using frozen semantics.

    This mirrors the frozen ByteDance research batch path:
    positions are computed in source-sample space with endpoint=False.
    """

    start = start_ms / 1000.0 * source_rate
    end = end_ms / 1000.0 * source_rate
    if start < -1e-6 or end > source.shape[0] + 1e-6 or end <= start:
        raise ValueError(f"Requested source window outside WAV: {start_ms}..{end_ms} ms")
    positions = np.linspace(start, end, output_samples, endpoint=False)
    left = np.floor(positions).astype(np.int64)
    right = np.minimum(source.shape[0] - 1, left + 1)
    frac = positions - left
    return (source[left] * (1.0 - frac) + source[right] * frac).astype(np.float32)
