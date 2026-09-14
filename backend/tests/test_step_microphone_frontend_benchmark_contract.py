from __future__ import annotations

import importlib.util
from pathlib import Path
import sys

import numpy as np


SCRIPTS_DIR = Path(__file__).parents[1] / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

SCRIPT_PATH = (
    SCRIPTS_DIR / "compare_step_microphone_frontends_causal_cases.py"
)
SPEC = importlib.util.spec_from_file_location(
    "compare_step_microphone_frontends_causal_cases",
    SCRIPT_PATH,
)
assert SPEC is not None
MODULE = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

EXTRACTOR_SCRIPT_PATH = (
    SCRIPTS_DIR / "extract_public_paired_step_causal_cases.py"
)
EXTRACTOR_SPEC = importlib.util.spec_from_file_location(
    "extract_public_paired_step_causal_cases",
    EXTRACTOR_SCRIPT_PATH,
)
assert EXTRACTOR_SPEC is not None
EXTRACTOR_MODULE = importlib.util.module_from_spec(EXTRACTOR_SPEC)
assert EXTRACTOR_SPEC.loader is not None
sys.modules[EXTRACTOR_SPEC.name] = EXTRACTOR_MODULE
EXTRACTOR_SPEC.loader.exec_module(EXTRACTOR_MODULE)


def test_local_frame_mask_empty_never_falls_back_to_whole_clip() -> None:
    raw_output = {
        "onset": np.ones((3, 88), dtype=np.float32),
        "frame": np.ones((3, 88), dtype=np.float32),
        "velocity": np.ones((3, 88), dtype=np.float32),
    }

    prediction = MODULE._activation_prediction(
        raw_output,
        expected_pitches=("C4",),
        clip_start_seconds=0.0,
        analysis_start_seconds=10.0,
        analysis_end_seconds=10.1,
        target_second=10.0,
        onset_threshold=0.5,
        frame_threshold=0.3,
    )

    evidence = prediction["expected_evidence"]["C4"]
    assert evidence["local_evidence_status"] == "NO_LOCAL_MODEL_FRAMES"
    assert evidence["accepted"] is False
    assert evidence["onset_activation"] is None
    assert evidence["frame_activation"] is None


def test_missing_chord_contamination_only_counts_future_counterfactual_pitch() -> None:
    case = {
        "ground_truth_note_events": (
            {"pitch": "C4", "start_seconds": 1.1},
            {"pitch": "E4", "start_seconds": 1.2},
        )
    }

    future_c4 = MODULE._future_target_contamination(
        case,
        expected_pitches=("C4", "E4"),
        actual_pitches=("C4",),
        target_second=1.0,
        decision_end_seconds=1.15,
    )
    future_e4 = MODULE._future_target_contamination(
        case,
        expected_pitches=("C4", "E4"),
        actual_pitches=("C4",),
        target_second=1.0,
        decision_end_seconds=1.25,
    )

    assert future_c4["counterfactual_pitches"] == ("E4",)
    assert future_c4["contaminated"] is False
    assert future_e4["contaminated"] is True
    assert future_e4["events"] == [
        {"pitch": "E4", "start_seconds": 1.2, "delta_ms": 200}
    ]


def test_same_source_audio_sha_uses_one_source_recording_identity() -> None:
    cases = (
        {
            "case_id": "a",
            "source_audio_sha256": "same-audio",
            "source_file": "/tmp/one.wav",
        },
        {
            "case_id": "b",
            "source_audio_sha256": "same-audio",
            "source_file": "/tmp/two.wav",
        },
    )

    readiness = MODULE._source_split_readiness(cases)

    assert readiness["source_recording_count"] == 1
    assert readiness["case_count_by_source_recording"] == {"same-audio": 2}
    assert readiness["source_recording_id_kind_counts"] == {"source_audio_sha256": 2}
    assert readiness["can_create_disjoint_calibration_evaluation_split"] is False


def test_split_readiness_requires_two_stable_source_audio_identities() -> None:
    one_source = (
        {"case_id": "a", "source_audio_sha256": "source-1"},
        {"case_id": "b", "source_audio_sha256": "source-1"},
    )
    two_sources = (
        {"case_id": "a", "source_audio_sha256": "source-1"},
        {"case_id": "b", "source_audio_sha256": "source-2"},
    )

    assert (
        MODULE._source_split_readiness(one_source)[
            "can_create_disjoint_calibration_evaluation_split"
        ]
        is False
    )
    assert (
        MODULE._source_split_readiness(two_sources)[
            "can_create_disjoint_calibration_evaluation_split"
        ]
        is True
    )


def test_positive_onset_timing_metadata_uses_actual_local_window() -> None:
    evaluations = [
        {
            "case_kind": "correct_strike",
            "group_results": [
                {
                    "analysis_neighborhood": {
                        "pre_seconds": 0.02,
                        "post_seconds": 0.08,
                    },
                    "expected_pitches": ("C4",),
                    "expected_evidence": {
                        "C4": {
                            "onset_activation": 0.9,
                            "frame_activation": 0.8,
                            "velocity_evidence": 0.7,
                            "onset_peak_time_relative_ms": 0,
                        }
                    },
                    "competitor_evidence": {"C4": {}},
                    "chord_summary": {},
                }
            ],
        }
    ]

    timing = MODULE._activation_evidence_summary(evaluations)["positive_onset_peak_timing"]

    assert timing["left_boundary_ms"] == -20.0
    assert timing["right_boundary_ms"] == 80.0


def test_no_retrigger_export_range_rejects_uncounted_second_group_pitch() -> None:
    spans = (
        EXTRACTOR_MODULE.MidiNoteSpan(
            pitch="F2",
            midi_note=41,
            start_seconds=1.0,
            end_seconds=1.6,
            velocity=80,
        ),
        EXTRACTOR_MODULE.MidiNoteSpan(
            pitch="F2",
            midi_note=41,
            start_seconds=2.35,
            end_seconds=2.5,
            velocity=70,
        ),
    )

    assert (
        EXTRACTOR_MODULE._has_uncounted_same_pitch_note_in_export_range(
            expected_pitches=("F2",),
            target_seconds=(1.0,),
            spans=spans,
            start_seconds=0.0,
            end_seconds=2.5,
        )
        is True
    )
    assert (
        EXTRACTOR_MODULE._has_uncounted_same_pitch_note_in_export_range(
            expected_pitches=("F2",),
            target_seconds=(1.0, 2.35),
            spans=spans,
            start_seconds=0.0,
            end_seconds=2.5,
        )
        is False
    )
