from __future__ import annotations

import json
import sys
from pathlib import Path

import pytest


REPO_ROOT = Path(__file__).resolve().parents[2]
REPORTS = REPO_ROOT / "backend" / "research" / "reports"
sys.path.insert(0, str(REPO_ROOT / "backend" / "research"))

from product_amt_rebaseline import (  # noqa: E402
    AcousticObservation,
    ExpectedStrike,
    SYNTHETIC_CONTRACT_STATUS,
    classify_realtime_queue,
    decode_conservative_hybrid,
    decode_contiguous_peak,
    decode_toy_regressed_local_peak,
    finalize_observations,
    initial_online_amt_toy_state,
    linear_resample,
    run_online_amt_bad_skip_intermediate,
    run_online_amt_grouped,
    run_online_amt_sequential,
    run_timer_feeder,
    toy_windowed_sinc_resample_contract,
    validate_audio_only_candidate_input,
    chosen_state_mismatch_count,
)


def fixture_hops() -> list[list[float]]:
    return [[(index + 1) * 0.01, (-1) ** index * 0.02, 0.005 * (index % 3)] for index in range(16)]


def test_online_amt_toy_contract_is_explicitly_synthetic_only() -> None:
    sequential = run_online_amt_sequential(initial_online_amt_toy_state(), fixture_hops())
    for k in [1, 2, 4, 8]:
        grouped = run_online_amt_grouped(initial_online_amt_toy_state(), fixture_hops(), k)
        assert len(grouped) == len(sequential)
        assert chosen_state_mismatch_count(sequential, grouped) == 0
        assert grouped[-1].state == sequential[-1].state
    assert SYNTHETIC_CONTRACT_STATUS == "SYNTHETIC_CONTRACT_TEST_ONLY"


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


def test_timer_feeder_is_marked_synthetic_contract_not_browser_evidence() -> None:
    result = run_timer_feeder([1, 1, 1], 4)
    assert result["actualTimerDriven"] is True
    assert result["evidenceStatus"] == SYNTHETIC_CONTRACT_STATUS
    assert len(result["rows"]) == 3


def test_toy_resampler_contract_is_not_production_bandlimited_validation() -> None:
    source = [0.0, 0.2, 0.6, 0.1, -0.1, 0.0, 0.3, 0.0]
    assert linear_resample(source, 4) == linear_resample(source, 4)
    assert toy_windowed_sinc_resample_contract(source, 4) == toy_windowed_sinc_resample_contract(source, 4)
    assert linear_resample(source, 4) != toy_windowed_sinc_resample_contract(source, 4)


def test_decoder_variants_are_named_as_toy_or_canonical_contracts() -> None:
    onset = [0.01, 0.31, 0.44, 0.29, 0.02, 0.35, 0.34, 0.01]
    frame = [0.1, 0.2, 0.6, 0.4, 0.1, 0.07, 0.06, 0.02]
    regression = [0.0, -0.2, -0.1, 0.0, 0.0, 0.15, -0.05, 0.0]

    contiguous = decode_contiguous_peak(onset, frame, 0.30, 0.05)
    toy_regressed = decode_toy_regressed_local_peak(onset, frame, regression, 0.30, 0.05)
    hybrid = decode_conservative_hybrid(onset, frame, regression, 0.30, 0.05)

    assert [event.frame for event in contiguous] == [2, 5]
    assert [event.frame for event in toy_regressed] == [2, 5]
    assert [event.frame for event in hybrid] == [2, 5]
    assert toy_regressed[0].onset_time_ms == 19.0


def test_candidate_boundary_rejects_score_truth_fields() -> None:
    with pytest.raises(ValueError, match="SCORE_TRUTH_FIELD_FORBIDDEN"):
        validate_audio_only_candidate_input({
            "pcm": [0.0],
            "sampleRateHz": 16000,
            "expectedPitch": 60,
            "truthMidi": "hidden",
        })
    validate_audio_only_candidate_input({"pcm": [0.0], "sampleRateHz": 16000, "sourceSegmentId": "dev"})


def test_one_correct_observation_cannot_satisfy_two_expected_strikes() -> None:
    expected = [
        ExpectedStrike("a", frozenset({60}), 1000, 1100),
        ExpectedStrike("b", frozenset({60}), 1030, 1130),
    ]
    result = finalize_observations(expected, [AcousticObservation("obs1", 60, 1010)], 60, analyzed_through_ms=1200)
    matched = [row for row in result["strikes"].values() if row["state"] == "correct"]
    assert len(matched) == 1
    assert result["consumedObservationIds"] == ["obs1"]


def role_by_observation(result: dict[str, object]) -> dict[str, str]:
    return {row["observation_id"]: row["disposition"] for row in result["observationRoles"]}


def test_future_observation_cannot_influence_current_frontier() -> None:
    expected = [ExpectedStrike("a", frozenset({60}), 1000, 1040)]
    result = finalize_observations(expected, [AcousticObservation("future", 60, 1000)], 60, analyzed_through_ms=900)
    assert result["strikes"]["a"]["state"] == "PENDING"
    assert role_by_observation(result)["future"] == "NOT_YET_VISIBLE"
    assert result["consumedObservationIds"] == []


def test_matching_pitch_after_deadline_cannot_retroactively_correct() -> None:
    expected = [ExpectedStrike("a", frozenset({60}), 1000, 1040)]
    result = finalize_observations(expected, [AcousticObservation("late", 60, 1050)], 60, analyzed_through_ms=1100)
    assert result["strikes"]["a"]["state"] == "missing"
    assert "late" not in result["consumedObservationIds"]


def test_same_pitch_matching_uses_global_minimum_timing_error() -> None:
    expected = [
        ExpectedStrike("a", frozenset({60}), 0, 20),
        ExpectedStrike("b", frozenset({60}), 5, 25),
    ]
    observations = [AcousticObservation("x", 60, 4), AcousticObservation("y", 60, 6)]
    result = finalize_observations(expected, observations, 10, analyzed_through_ms=30)
    assert result["strikes"]["a"]["matchedObservationIds"] == ["x"]
    assert result["strikes"]["b"]["matchedObservationIds"] == ["y"]


def test_rapid_same_pitch_expected_retriggers_are_not_duplicate_suppressed_before_matching() -> None:
    expected = [
        ExpectedStrike("a", frozenset({60}), 1000, 1100),
        ExpectedStrike("b", frozenset({60}), 1020, 1120),
    ]
    observations = [AcousticObservation("x", 60, 1000), AcousticObservation("y", 60, 1020)]
    result = finalize_observations(expected, observations, 10, analyzed_through_ms=1200, duplicate_window_ms=25)
    assert result["strikes"]["a"]["state"] == "correct"
    assert result["strikes"]["b"]["state"] == "correct"
    assert result["duplicateSuppressedObservationIds"] == []


def test_one_wrong_observation_cannot_mark_two_overlapping_strikes_wrong() -> None:
    expected = [
        ExpectedStrike("a", frozenset({60}), 1000, 1100),
        ExpectedStrike("b", frozenset({62}), 1020, 1120),
    ]
    result = finalize_observations(expected, [AcousticObservation("wrong", 61, 1010)], 60, analyzed_through_ms=1200)
    wrong = [row for row in result["strikes"].values() if row["state"] == "wrong"]
    assert len(wrong) == 1
    assert sum("wrong" in row["wrongObservationIds"] for row in result["strikes"].values()) == 1


def test_correct_plus_nonexpected_pitch_becomes_correct_and_extra() -> None:
    expected = [ExpectedStrike("a", frozenset({60}), 1000, 1100)]
    observations = [AcousticObservation("correct", 60, 1000), AcousticObservation("d4", 62, 1005)]
    result = finalize_observations(expected, observations, 60, analyzed_through_ms=1200)
    assert result["strikes"]["a"]["state"] == "correct"
    assert role_by_observation(result)["d4"] == "extra"


def test_partial_chord_plus_nonexpected_pitch_becomes_incomplete_and_extra() -> None:
    expected = [ExpectedStrike("chord", frozenset({60, 64, 67}), 1000, 1100)]
    observations = [AcousticObservation("c4", 60, 1000), AcousticObservation("d4", 62, 1005)]
    result = finalize_observations(expected, observations, 60, analyzed_through_ms=1200)
    assert result["strikes"]["chord"]["state"] == "incomplete_chord"
    assert role_by_observation(result)["d4"] == "extra"


def test_strikes_remain_pending_before_deadline() -> None:
    expected = [ExpectedStrike("a", frozenset({60}), 1000, 1200)]
    no_note = finalize_observations(expected, [], 60, analyzed_through_ms=1100)
    wrong_note = finalize_observations(expected, [AcousticObservation("wrong", 61, 1005)], 60, analyzed_through_ms=1100)
    partial = finalize_observations([ExpectedStrike("chord", frozenset({60, 64}), 1000, 1200)], [AcousticObservation("partial", 60, 1000)], 60, 1100)
    assert no_note["strikes"]["a"]["state"] == "PENDING"
    assert wrong_note["strikes"]["a"]["state"] == "PENDING"
    assert partial["strikes"]["chord"]["state"] == "PENDING"
    assert role_by_observation(wrong_note)["wrong"] == "unresolved"


def test_wrong_candidate_after_deadline_becomes_unique_wrong_evidence() -> None:
    expected = [ExpectedStrike("a", frozenset({60}), 1000, 1200)]
    result = finalize_observations(expected, [AcousticObservation("wrong", 61, 1005)], 60, analyzed_through_ms=1300)
    assert result["strikes"]["a"]["state"] == "wrong"
    assert result["strikes"]["a"]["wrongObservationIds"] == ["wrong"]
    assert role_by_observation(result)["wrong"] == "wrong_evidence"


def test_complete_chord_may_finalize_correct_before_deadline() -> None:
    expected = [ExpectedStrike("chord", frozenset({60, 64}), 1000, 1200)]
    result = finalize_observations(expected, [AcousticObservation("a", 60, 995), AcousticObservation("b", 64, 1005)], 60, 1050)
    assert result["strikes"]["chord"]["state"] == "correct"


def test_incomplete_missing_wrong_and_extra_after_deadline() -> None:
    expected = [
        ExpectedStrike("missing", frozenset({60}), 1000, 1100),
        ExpectedStrike("wrong", frozenset({62}), 1300, 1400),
        ExpectedStrike("incomplete", frozenset({64, 67}), 1600, 1700),
    ]
    observations = [
        AcousticObservation("wrong-obs", 63, 1300),
        AcousticObservation("partial", 64, 1600),
        AcousticObservation("extra", 72, 2100),
    ]
    result = finalize_observations(expected, observations, 60, 2200)
    assert result["strikes"]["missing"]["state"] == "missing"
    assert result["strikes"]["wrong"]["state"] == "wrong"
    assert result["strikes"]["incomplete"]["state"] == "incomplete_chord"
    assert result["extras"] == ["extra"]


def test_duplicate_same_pitch_attacks_are_not_all_silently_consumed() -> None:
    expected = [ExpectedStrike("a", frozenset({60}), 1000, 1100)]
    observations = [
        AcousticObservation("main", 60, 1000, confidence=0.9),
        AcousticObservation("dupe", 60, 1008, confidence=0.5),
    ]
    result = finalize_observations(expected, observations, 60, 1200, duplicate_window_ms=25)
    assert result["strikes"]["a"]["state"] == "correct"
    assert result["duplicateSuppressedObservationIds"] == ["dupe"]


def test_genuine_residual_attack_is_extra_exactly_once() -> None:
    expected = [ExpectedStrike("a", frozenset({60}), 1000, 1100)]
    observations = [AcousticObservation("main", 60, 1000), AcousticObservation("real-extra", 60, 1080)]
    result = finalize_observations(expected, observations, 20, analyzed_through_ms=1200, duplicate_window_ms=25)
    roles = [row for row in result["observationRoles"] if row["observation_id"] == "real-extra"]
    assert roles == [{"observation_id": "real-extra", "disposition": "extra", "strike_id": None, "pitch": None}]


def test_every_visible_observation_has_exactly_one_disposition() -> None:
    expected = [ExpectedStrike("a", frozenset({60}), 1000, 1100)]
    observations = [
        AcousticObservation("main", 60, 1000),
        AcousticObservation("dupe", 60, 1005),
        AcousticObservation("extra", 62, 1300),
        AcousticObservation("future", 64, 2000),
    ]
    result = finalize_observations(expected, observations, 60, analyzed_through_ms=1400)
    ids = [row["observation_id"] for row in result["observationRoles"]]
    assert sorted(ids) == ["dupe", "extra", "future", "main"]
    assert len(ids) == len(set(ids))


def test_finalized_verdicts_are_monotonic_across_advancing_frontier() -> None:
    expected = [ExpectedStrike("a", frozenset({60}), 1000, 1040)]
    observations = [AcousticObservation("late", 60, 1050)]
    pending = finalize_observations(expected, observations, 60, analyzed_through_ms=1030)
    missing = finalize_observations(expected, observations, 60, analyzed_through_ms=1100)
    later = finalize_observations(expected, observations, 60, analyzed_through_ms=1300)
    assert pending["strikes"]["a"]["state"] == "PENDING"
    assert missing["strikes"]["a"]["state"] == "missing"
    assert later["strikes"]["a"]["state"] == "missing"


def test_protection_reads_actual_phase9gb_result_and_product_microphone_code() -> None:
    result_path = REPORTS / "phase9g_b3_official_product_blind_replacement_result_2026-10-11.json"
    result = json.loads(result_path.read_text(encoding="utf-8"))
    assert result["benchmarkOutcome"] == "STATISTICAL_TIE"
    assert result["winner"] is None

    practice_hook = (REPO_ROOT / "apps/customer-web/src/hooks/practice/use-local-practice.ts").read_text(encoding="utf-8")
    assert "CONTINUOUS_ANALYSIS_UNAVAILABLE_REASON" in practice_hook
    assert "STEP_ANALYSIS_UNAVAILABLE_REASON" in practice_hook
    assert "Continuous microphone analysis is unavailable." in practice_hook


def test_no_practice_server_runtime_or_new_p15_p22_artifact_in_repair_report() -> None:
    report_path = REPORTS / "phase9g_dr2_finalizer_correctness_and_real_grouped_execution_2026-10-13.json"
    if report_path.exists():
        report = json.loads(report_path.read_text(encoding="utf-8"))
        assert report["p15p22InferenceIncrease"] == 0
        assert report["productionMicrophoneEnabled"] is False
        assert report["historicalPhase9gBConclusion"] == {"outcome": "STATISTICAL_TIE", "winner": None}
        assert report["recommendation"] == "REBASELINE_RUNTIME_EVIDENCE_INCOMPLETE"
        assert report["greenfieldBoundary"] == "GREENFIELD_AUDIO_ONLY_ACOUSTIC_CONTRACT"
        assert report["historicalScoreAwareAdapter"] == "SCORE_AWARE_9G_RESEARCH_ADAPTER"
        assert report["finalizerBehavioralEvidence"]["expectedMatchingPolicy"] == "MAX_CARDINALITY_MIN_TOTAL_TIMING_ERROR_PER_PITCH"
        assert "NO_EXISTING_CANDIDATE_MEETS_PRODUCT_GATE_CUSTOM_MODEL_REQUIRED" not in json.dumps(report)
        for row in report["kHopGraphIdentities"].values():
            assert row["status"] in {"NOT_EXPORTED_RUNTIME_BLOCKED", "PASS", "FAILED"}

    server_runtime_terms = ["Practice WebSocket", "server-side Practice inference", "backend PracticeSession runtime"]
    active_sources = "\n".join(
        path.read_text(encoding="utf-8", errors="ignore")
        for path in (REPO_ROOT / "apps/customer-web/src/lib/practice").rglob("*.ts")
        if ".test." not in path.name
    )
    for term in server_runtime_terms:
        assert term not in active_sources
