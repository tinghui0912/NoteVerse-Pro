from __future__ import annotations

import sys
from pathlib import Path

import numpy as np


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))

from evaluate_bytedance_oracle_rolling_buffer import (  # noqa: E402
    FUTURE_PREFIX_SAMPLES,
    REAL_LOOKBACK_SAMPLES,
    SAMPLE_RATE,
    TARGET_ANCHOR_SAMPLES,
    TENSOR_SAMPLES,
    RollingPcmBuffer,
    _array_hash,
    _extract_fixed_anchor_tensor_from_buffer,
    _fixed_anchor_tensor_from_audio,
)


def test_rolling_buffer_fixed_anchor_tensor_matches_offline_exactly() -> None:
    audio = np.linspace(-0.5, 0.5, SAMPLE_RATE * 4, dtype=np.float32)
    target_sample = SAMPLE_RATE * 2 + 123
    decision_sample = target_sample + FUTURE_PREFIX_SAMPLES
    buffer = RollingPcmBuffer(max_retained_samples=40_000)

    for offset in range(0, decision_sample + 317, 640):
        buffer.append(audio[offset : offset + 640])
        if buffer.received_samples >= decision_sample:
            break

    rolling = _extract_fixed_anchor_tensor_from_buffer(
        buffer,
        target_sample=target_sample,
        decision_sample=decision_sample,
    )
    offline = _fixed_anchor_tensor_from_audio(audio, target_sample=target_sample)

    assert rolling.shape == offline.shape == (TENSOR_SAMPLES,)
    assert TARGET_ANCHOR_SAMPLES == REAL_LOOKBACK_SAMPLES + (TARGET_ANCHOR_SAMPLES - REAL_LOOKBACK_SAMPLES)
    assert np.array_equal(rolling, offline)
    assert _array_hash(rolling) == _array_hash(offline)


def test_rolling_buffer_truncates_chunk_overshoot_at_future_boundary() -> None:
    audio = np.arange(SAMPLE_RATE * 3, dtype=np.float32)
    target_sample = SAMPLE_RATE
    decision_sample = target_sample + FUTURE_PREFIX_SAMPLES
    buffer = RollingPcmBuffer(max_retained_samples=40_000)

    oversized_chunk_end = decision_sample + 500
    for offset in range(0, oversized_chunk_end, 640):
        buffer.append(audio[offset : offset + 640])
        if buffer.received_samples >= oversized_chunk_end:
            break

    rolling = _extract_fixed_anchor_tensor_from_buffer(
        buffer,
        target_sample=target_sample,
        decision_sample=decision_sample,
    )

    assert rolling.size == TENSOR_SAMPLES
    assert rolling[-1] == audio[decision_sample - 1]
    assert audio[decision_sample] not in rolling


def test_rolling_buffer_generates_left_zeros_without_storing_synthetic_pcm() -> None:
    audio = np.ones(SAMPLE_RATE, dtype=np.float32)
    target_sample = SAMPLE_RATE // 4
    decision_sample = target_sample + FUTURE_PREFIX_SAMPLES
    buffer = RollingPcmBuffer(max_retained_samples=40_000)
    buffer.append(audio[: decision_sample + 10])

    rolling = _extract_fixed_anchor_tensor_from_buffer(
        buffer,
        target_sample=target_sample,
        decision_sample=decision_sample,
    )

    expected_zero_count = TARGET_ANCHOR_SAMPLES - target_sample
    assert expected_zero_count > 0
    assert np.all(rolling[:expected_zero_count] == 0)
    assert np.all(rolling[expected_zero_count:] == 1)
    assert buffer.start_sample_index == 0
