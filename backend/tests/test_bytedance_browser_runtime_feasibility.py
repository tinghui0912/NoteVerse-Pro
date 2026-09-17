from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

SCRIPTS_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import evaluate_bytedance_browser_runtime_feasibility as feasibility


def test_fixed_anchor_clip_keeps_target_at_1600ms() -> None:
    sample_rate = 16_000
    audio = np.ones(sample_rate * 3, dtype=np.float32)
    case = {
        "case_id": "case",
        "source_time_range_seconds": [0.2, 3.2],
        "target_group_seconds": [1.2],
    }

    clip, meta = feasibility._fixed_anchor_clip(case, audio, sample_rate, group_index=0)

    assert clip.shape == (29_120,)
    assert meta["target_anchor_sample"] == 25_600
    assert meta["zero_pad_ms"] == 600.0
    assert meta["available_real_lookback_ms"] == 1000.0
    assert np.all(clip[:9_600] == 0.0)
    assert np.all(clip[9_600:] == 1.0)


def test_select_fixture_groups_uses_second_group_for_retrigger() -> None:
    cases = [
        (
            Path("manifest.json"),
            {
                "case_id": "single",
                "case_kind": "correct_strike",
                "expected_groups": [["C4"]],
            },
        ),
        (
            Path("manifest.json"),
            {
                "case_id": "chord",
                "case_kind": "correct_chord",
                "expected_groups": [["C4", "E4"]],
            },
        ),
        (
            Path("manifest.json"),
            {
                "case_id": "retrigger",
                "case_kind": "same_note_retrigger",
                "expected_groups": [["C4"], ["C4"]],
            },
        ),
    ]

    selected = feasibility._select_fixture_groups(
        cases,
        kinds=["correct_strike", "correct_chord", "same_note_retrigger"],
    )

    assert [item["case"]["case_id"] for item in selected] == ["single", "chord", "retrigger"]
    assert [item["group_index"] for item in selected] == [0, 0, 1]
