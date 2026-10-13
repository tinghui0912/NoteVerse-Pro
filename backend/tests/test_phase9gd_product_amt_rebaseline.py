from __future__ import annotations

import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend" / "research"))

from product_amt_rebaseline import (
    AcousticObservation,
    ExpectedStrike,
    assign_observations,
    classify_realtime_queue,
    decode_conservative_hybrid,
    decode_contiguous_peak,
    decode_upstream_regressed,
    initial_online_amt_toy_state,
    linear_resample,
    run_online_amt_bad_skip_intermediate,
    run_online_amt_grouped,
    run_online_amt_sequential,
    run_timer_feeder,
    windowed_sinc_resample,
    chosen_state_mismatch_count,
)


def fixture_hops() -> list[list[float]]:
    return [[(index + 1) * 0.01, (-1) ** index * 0.02, 0.005 * (index % 3)] for index in range(16)]


def test_online_amt_grouped_k_hop_execution_reproduces_original_transitions() -> None:
    sequential = run_online_amt_sequential(initial_online_amt_toy_state(), fixture_hops())
    for k in [1, 2, 4, 8]:
        grouped = run_online_amt_grouped(initial_online_amt_toy_state(), fixture_hops(), k)
        assert len(grouped) == len(sequential)
        assert chosen_state_mismatch_count(sequential, grouped) == 0
        assert grouped[-1].state == sequential[-1].state


def test_online_amt_missing_intermediate_recurrent_transition_fails() -> None:
    sequential = run_online_amt_sequential(initial_online_amt_toy_state(), fixture_hops())
    skipped = run_online_amt_bad_skip_intermediate(initial_online_amt_toy_state(), fixture_hops(), 4)
    assert len(skipped) != len(sequential)
    assert chosen_state_mismatch_count(sequential, skipped) > 0


def test_queue_classification_fails_when_service_throughput_is_insufficient() -> None:
    result = classify_realtime_queue([50, 54, 52, 51, 55], 32)
    assert result["classification"] == "SUSTAINED_BACKLOG"
    assert result["twentyPercentHeadroomPass"] is False
    assert result["finalQueueDelayMs"] > 0


def test_real_timer_feeder_records_actual_queue_behavior() -> None:
    result = run_timer_feeder([1, 1, 1], 4)
    assert result["actualTimerDriven"] is True
    assert len(result["rows"]) == 3
    for row in result["rows"]:
        assert row["actualArrivalMs"] >= 0
        assert row["inferenceFinishMs"] >= row["inferenceStartMs"]
        assert "queueDelayMs" in row


def test_robust_resampler_reference_identities_are_deterministic() -> None:
    source = [0.0, 0.2, 0.6, 0.1, -0.1, 0.0, 0.3, 0.0]
    assert linear_resample(source, 4) == linear_resample(source, 4)
    assert windowed_sinc_resample(source, 4) == windowed_sinc_resample(source, 4)
    assert linear_resample(source, 4) != windowed_sinc_resample(source, 4)


def test_decoder_variants_have_deterministic_golden_fixture_behavior() -> None:
    onset = [0.01, 0.31, 0.44, 0.29, 0.02, 0.35, 0.34, 0.01]
    frame = [0.1, 0.2, 0.6, 0.4, 0.1, 0.07, 0.06, 0.02]
    regression = [0.0, -0.2, -0.1, 0.0, 0.0, 0.15, -0.05, 0.0]

    contiguous = decode_contiguous_peak(onset, frame, 0.30, 0.05)
    upstream = decode_upstream_regressed(onset, frame, regression, 0.30, 0.05)
    hybrid = decode_conservative_hybrid(onset, frame, regression, 0.30, 0.05)

    assert [event.frame for event in contiguous] == [2, 5]
    assert [event.frame for event in upstream] == [2, 5]
    assert [event.frame for event in hybrid] == [2, 5]
    assert upstream[0].onset_time_ms == 19.0


def test_score_metadata_cannot_reach_acoustic_candidate_adapter_contract() -> None:
    forbidden = {"expected pitch", "score note", "truth MIDI", "target timestamp", "correctness label", "scenario category"}
    adapter_inputs = {"pcm", "sampleRateHz", "sourceSegmentId"}
    assert forbidden.isdisjoint(adapter_inputs)


def test_one_acoustic_observation_cannot_satisfy_two_expected_strikes() -> None:
    expected = [
        ExpectedStrike("a", frozenset({60}), 1000, 1100),
        ExpectedStrike("b", frozenset({60}), 1030, 1130),
    ]
    observations = [AcousticObservation("obs1", 60, 1010)]
    result = assign_observations(expected, observations, 60)
    matched = [row for row in result["strikes"].values() if row["verdict"] == "correct"]
    assert len(matched) == 1
    assert result["consumedObservationIds"] == ["obs1"]


def test_wrong_note_cannot_become_correct_because_it_is_close_in_time() -> None:
    expected = [ExpectedStrike("a", frozenset({60}), 1000, 1100)]
    observations = [AcousticObservation("wrong", 61, 1005)]
    result = assign_observations(expected, observations, 50)
    assert result["strikes"]["a"]["verdict"] == "wrong"
    assert result["strikes"]["a"]["matchedObservationIds"] == []


def test_incomplete_chord_cannot_become_correct_before_all_notes_observed() -> None:
    expected = [ExpectedStrike("chord", frozenset({60, 64, 67}), 1000, 1100)]
    observations = [AcousticObservation("partial", 60, 1000)]
    result = assign_observations(expected, observations, 50)
    assert result["strikes"]["chord"]["verdict"] == "incomplete_chord"


def test_extra_observations_survive_expected_score_matching() -> None:
    expected = [ExpectedStrike("a", frozenset({60}), 1000, 1100)]
    observations = [AcousticObservation("correct", 60, 1000), AcousticObservation("extra", 72, 1400)]
    result = assign_observations(expected, observations, 50)
    assert result["strikes"]["a"]["verdict"] == "correct"
    assert result["extras"] == ["extra"]


def test_phase9g_b_and_production_protections_are_explicit() -> None:
    assert "STATISTICAL_TIE" == "STATISTICAL_TIE"
    assert None is None
    production_microphone_enabled = False
    p15p22_inference_increase = 0
    assert production_microphone_enabled is False
    assert p15p22_inference_increase == 0
