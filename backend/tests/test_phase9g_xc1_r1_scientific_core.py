from __future__ import annotations

from pathlib import Path

import pytest

from research.xc1_scientific_bakeoff import (
    OnsetEvent,
    assert_stage_a_cannot_access_midi,
    canonical_json_sha256,
    create_stage_a_audio_only_root,
    decide_front_runner,
    is_real_acoustic_wav,
    linear_resample,
    match_pitch_onsets,
    paired_bootstrap,
    pair_smd_audio_midi,
    runtime_eligibility,
    score_take,
    select_edge_subset,
)


def test_pitch_matching_maximizes_cardinality_then_minimizes_total_error() -> None:
    truth = [
        OnsetEvent("A", 60, 0),
        OnsetEvent("B", 60, 5),
    ]
    predictions = [
        OnsetEvent("X", 60, 4),
        OnsetEvent("Y", 60, 6),
    ]

    result = match_pitch_onsets(truth, predictions, 10)

    assert [(item["truthId"], item["predictionId"]) for item in result["matches"]] == [("A", "X"), ("B", "Y")]
    assert sum(item["absErrorMs"] for item in result["matches"]) == 5


def test_one_prediction_and_one_truth_are_each_consumed_at_most_once() -> None:
    result = match_pitch_onsets(
        [OnsetEvent("truth-1", 60, 100), OnsetEvent("truth-2", 60, 102)],
        [OnsetEvent("pred-1", 60, 101)],
        10,
    )

    assert len(result["matches"]) == 1
    assert len(result["unmatchedTruthIds"]) == 1
    assert result["unmatchedPredictionIds"] == []


def test_score_take_reports_primary_metrics_and_duplicate_diagnostic() -> None:
    result = score_take(
        [OnsetEvent("t1", 60, 100), OnsetEvent("t2", 64, 200)],
        [
            OnsetEvent("p1", 60, 105),
            OnsetEvent("p2", 60, 110),
            OnsetEvent("p3", 67, 220),
        ],
        duration_seconds=10,
        tolerance_ms=50,
    )

    assert result["precision"] == pytest.approx(1 / 3)
    assert result["recall"] == pytest.approx(1 / 2)
    assert result["falsePositiveOnsetsPerMinute"] == pytest.approx(12)
    assert result["duplicateRetriggerFalseDetections"] == 1


def test_paired_bootstrap_is_take_level_and_deterministic() -> None:
    rows = [
        {"takeId": "a", "candidateId": "robust-browser-v1", "f1": 0.8},
        {"takeId": "a", "candidateId": "basic-pitch-browser-v1", "f1": 0.7},
        {"takeId": "b", "candidateId": "robust-browser-v1", "f1": 0.6},
        {"takeId": "b", "candidateId": "basic-pitch-browser-v1", "f1": 0.5},
    ]

    first = paired_bootstrap(rows, "robust-browser-v1", "basic-pitch-browser-v1", "f1", draws=100, seed=13371)
    second = paired_bootstrap(rows, "robust-browser-v1", "basic-pitch-browser-v1", "f1", draws=100, seed=13371)

    assert first == second
    assert first["meanDiff"] == pytest.approx(0.1)
    assert first["outputDigest"] == canonical_json_sha256([round(0.1, 12)] * 100)


def test_runtime_and_front_runner_policy_are_executable() -> None:
    assert runtime_eligibility("online-amt-k8-browser-v1", 204.8, False)["runtimeEligible"] is True
    assert runtime_eligibility("robust-browser-v1", 481, False)["runtimeEligible"] is False
    assert runtime_eligibility("basic-pitch-browser-v1", 100, True)["runtimeEligible"] is False

    outcome = decide_front_runner(
        {
            "robust-browser-v1": {"runtimeEligible": True, "completeCoverage": True},
            "online-amt-k8-browser-v1": {"runtimeEligible": True, "completeCoverage": True},
            "basic-pitch-browser-v1": {"runtimeEligible": True, "completeCoverage": True},
        },
        {
            "robust-browser-v1__online-amt-k8-browser-v1__f1": {"ci95": [0.01, 0.1]},
            "robust-browser-v1__basic-pitch-browser-v1__f1": {"ci95": [0.02, 0.1]},
            "robust-browser-v1__online-amt-k8-browser-v1__falsePositiveOnsetsPerMinute": {"ci95": [-1, 1]},
            "robust-browser-v1__basic-pitch-browser-v1__falsePositiveOnsetsPerMinute": {"ci95": [-1, 1]},
            "robust-browser-v1__online-amt-k8-browser-v1__missedOnsetRate": {"ci95": [-0.1, 0.1]},
            "robust-browser-v1__basic-pitch-browser-v1__missedOnsetRate": {"ci95": [-0.1, 0.1]},
            "online-amt-k8-browser-v1__robust-browser-v1__f1": {"ci95": [-0.1, -0.01]},
            "online-amt-k8-browser-v1__basic-pitch-browser-v1__f1": {"ci95": [0.0, 0.1]},
            "online-amt-k8-browser-v1__robust-browser-v1__falsePositiveOnsetsPerMinute": {"ci95": [-1, 1]},
            "online-amt-k8-browser-v1__basic-pitch-browser-v1__falsePositiveOnsetsPerMinute": {"ci95": [-1, 1]},
            "online-amt-k8-browser-v1__robust-browser-v1__missedOnsetRate": {"ci95": [-0.1, 0.1]},
            "online-amt-k8-browser-v1__basic-pitch-browser-v1__missedOnsetRate": {"ci95": [-0.1, 0.1]},
            "basic-pitch-browser-v1__robust-browser-v1__f1": {"ci95": [-0.1, -0.02]},
            "basic-pitch-browser-v1__online-amt-k8-browser-v1__f1": {"ci95": [-0.1, 0.0]},
            "basic-pitch-browser-v1__robust-browser-v1__falsePositiveOnsetsPerMinute": {"ci95": [-1, 1]},
            "basic-pitch-browser-v1__online-amt-k8-browser-v1__falsePositiveOnsetsPerMinute": {"ci95": [-1, 1]},
            "basic-pitch-browser-v1__robust-browser-v1__missedOnsetRate": {"ci95": [-0.1, 0.1]},
            "basic-pitch-browser-v1__online-amt-k8-browser-v1__missedOnsetRate": {"ci95": [-0.1, 0.1]},
        },
    )
    assert outcome == "SCIENTIFIC_ACOUSTIC_FRONT_RUNNER_ROBUST_BROWSER"


def test_stage_a_root_excludes_midi_truth(tmp_path: Path) -> None:
    pcm = tmp_path / "take.pcm"
    pcm.write_bytes(b"pcm")
    root = tmp_path / "stage_a"

    receipt = create_stage_a_audio_only_root(root, [pcm], {"takes": ["take"]})

    assert receipt["containsMidi"] is False
    assert assert_stage_a_cannot_access_midi(root, "truth/take.mid") is True
    (root / "truth").mkdir()
    (root / "truth" / "take.mid").write_bytes(b"midi")
    with pytest.raises(AssertionError, match="XC1_STAGE_A_TRUTH_BOUNDARY_VIOLATION"):
        assert_stage_a_cannot_access_midi(root, "truth/take.mid")


def test_smd_pairing_rejects_midi_rendered_audio() -> None:
    assert is_real_acoustic_wav("wav_44100_stereo/take01.wav") is True
    assert is_real_acoustic_wav("midi_wav_22050_mono/take01.wav") is False
    paired = pair_smd_audio_midi([
        {"relativePath": "wav_44100_stereo/take01.wav", "bytes": 10, "fileType": "wav"},
        {"relativePath": "midi_wav_22050_mono/take01.wav", "bytes": 10, "fileType": "wav"},
        {"relativePath": "midi/take01.mid", "bytes": 5, "fileType": "mid"},
    ])

    assert paired["pairCount"] == 1
    assert paired["pairs"][0]["takeId"] == "take01"


def test_linear_resample_and_edge_subset_are_deterministic() -> None:
    assert linear_resample([0.0, 1.0, 0.0, -1.0], 4, 2) == [0.0, 0.0]
    takes = [{"takeId": f"take-{index}", "pieceId": f"piece-{index % 3}", "performerId": f"p{index % 2}"} for index in range(12)]
    assert select_edge_subset(takes, count=4) == select_edge_subset(takes, count=4)
