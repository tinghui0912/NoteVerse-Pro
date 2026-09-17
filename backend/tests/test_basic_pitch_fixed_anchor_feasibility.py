from __future__ import annotations

import numpy as np
import pytest


def test_basic_pitch_browser_frame_time_formula_matches_python_official() -> None:
    note_creation = pytest.importorskip("basic_pitch.note_creation")
    constants = pytest.importorskip("basic_pitch.constants")

    frame_count = 220
    official = note_creation.model_frames_to_time(frame_count)

    frame_indices = np.arange(frame_count, dtype=np.float64)
    original_times = frame_indices * constants.FFT_HOP / constants.AUDIO_SAMPLE_RATE
    window_numbers = np.floor(frame_indices / constants.ANNOT_N_FRAMES)
    window_offset = (
        constants.FFT_HOP
        / constants.AUDIO_SAMPLE_RATE
        * (constants.ANNOT_N_FRAMES - constants.AUDIO_N_SAMPLES / constants.FFT_HOP)
        + 0.0018
    )
    browser_equivalent = original_times - window_offset * window_numbers

    np.testing.assert_allclose(browser_equivalent, official, rtol=0.0, atol=1e-12)
