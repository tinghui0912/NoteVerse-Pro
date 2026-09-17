from __future__ import annotations

import sys
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))

import pytest

from evaluate_bytedance_step_verifier_adapter_parity import (
    _adapter_config_from_policy,
    _compare_against_reference,
    _exit_code_for_parity,
)


def test_parity_comparator_fails_when_reference_row_is_missing_from_adapter() -> None:
    reference = [_case("case-a", _result("single", "transition-a"))]

    parity = _compare_against_reference([], {"evaluations": reference})

    assert parity["key_contract"]["failed"] is True
    assert parity["key_contract"]["missing_adapter_rows"] == [
        {
            "source_recording_id": "source-1",
            "case_id": "case-a",
            "case_kind": "correct_single",
            "family": "single",
            "transition_key": "transition-a",
        }
    ]


def test_parity_comparator_fails_when_adapter_has_extra_transition() -> None:
    adapter = [
        _case(
            "case-a",
            _result("single", "transition-a"),
            _result("single", "transition-extra"),
        )
    ]
    reference = [_case("case-a", _result("single", "transition-a"))]

    parity = _compare_against_reference(adapter, {"evaluations": reference})

    assert parity["key_contract"]["failed"] is True
    assert parity["key_contract"]["extra_adapter_rows"] == [
        {
            "source_recording_id": "source-1",
            "case_id": "case-a",
            "case_kind": "correct_single",
            "family": "single",
            "transition_key": "transition-extra",
        }
    ]


def test_parity_comparator_uses_keys_not_row_order() -> None:
    adapter = [
        _case(
            "case-a",
            _result("single", "transition-b"),
            _result("single", "transition-a"),
        )
    ]
    reference = [
        _case(
            "case-a",
            _result("single", "transition-a"),
            _result("single", "transition-b"),
        )
    ]

    parity = _compare_against_reference(adapter, {"evaluations": reference})

    assert parity["key_contract"]["failed"] is False
    assert parity["diff_count"] == 0


def test_parity_comparator_classifies_one_sample_before_activation_as_expected_difference() -> None:
    active_from = 10.0
    one_sample_before = active_from - (1.0 / 16000.0)
    adapter = [
        _case(
            "case-a",
            _result("single", "transition-a", auto_advanced=False, active_from=active_from),
        )
    ]
    reference = [
        _case(
            "case-a",
            _result(
                "single",
                "transition-a",
                auto_advanced=True,
                active_from=active_from,
                event_time=one_sample_before,
            ),
        )
    ]

    parity = _compare_against_reference(adapter, {"evaluations": reference})

    assert parity["key_contract"]["failed"] is False
    assert parity["diff_count"] == 1
    assert parity["expected_activation_contract_difference_count"] == 1
    assert parity["unexpected_adapter_mismatch_count"] == 0
    assert parity["diffs"][0]["reason"] == "EXPECTED_ACTIVATION_CONTRACT_DIFFERENCE"


def test_parity_comparator_does_not_exempt_event_exactly_at_activation_sample() -> None:
    active_from = 10.0
    adapter = [
        _case(
            "case-a",
            _result("single", "transition-a", auto_advanced=False, active_from=active_from),
        )
    ]
    reference = [
        _case(
            "case-a",
            _result(
                "single",
                "transition-a",
                auto_advanced=True,
                active_from=active_from,
                event_time=active_from,
            ),
        )
    ]

    parity = _compare_against_reference(adapter, {"evaluations": reference})

    assert parity["expected_activation_contract_difference_count"] == 0
    assert parity["unexpected_adapter_mismatch_count"] == 1
    assert parity["diffs"][0]["reason"] == "UNEXPECTED_ADAPTER_MISMATCH"


def test_parity_comparator_chord_with_any_pre_activation_event_is_expected_difference() -> None:
    active_from = 10.0
    one_sample_before = active_from - (1.0 / 16000.0)
    one_sample_after = active_from + (1.0 / 16000.0)
    adapter = [
        _case(
            "case-a",
            _result("chord", "transition-a", auto_advanced=False, active_from=active_from),
        )
    ]
    reference = [
        _case(
            "case-a",
            _result(
                "chord",
                "transition-a",
                auto_advanced=True,
                active_from=active_from,
                event_times=(one_sample_before, one_sample_after),
            ),
        )
    ]

    parity = _compare_against_reference(adapter, {"evaluations": reference})

    assert parity["expected_activation_contract_difference_count"] == 1
    assert parity["unexpected_adapter_mismatch_count"] == 0


def test_parity_comparator_does_not_exempt_unrelated_adapter_failure() -> None:
    adapter = [
        _case(
            "case-a",
            _result(
                "same_note",
                "transition-a",
                auto_advanced=True,
                active_from=10.0,
                event_time=10.02,
                second_classification="PREMATURE_FALSE_ADVANCE",
            ),
        )
    ]
    reference = [
        _case(
            "case-a",
            _result(
                "same_note",
                "transition-a",
                auto_advanced=True,
                active_from=10.0,
                event_time=9.99,
                second_classification="LEGITIMATE_ADVANCE",
            ),
        )
    ]

    parity = _compare_against_reference(adapter, {"evaluations": reference})

    assert parity["expected_activation_contract_difference_count"] == 0
    assert parity["unexpected_adapter_mismatch_count"] == 1
    assert parity["diffs"][0]["reason"] == "UNEXPECTED_ADAPTER_MISMATCH"


def test_parity_comparator_filters_reference_to_adapter_case_keys_for_case_limit() -> None:
    adapter = [_case("case-a", _result("single", "transition-a"))]
    reference = [
        _case("case-a", _result("single", "transition-a")),
        _case("case-b", _result("single", "transition-b")),
    ]

    parity = _compare_against_reference(adapter, {"evaluations": reference})

    assert parity["key_contract"]["failed"] is False
    assert parity["key_contract"]["adapter_key_count"] == 1
    assert parity["key_contract"]["reference_key_count"] == 1
    assert parity["diff_count"] == 0


def test_parity_exit_code_fails_on_key_contract_failure() -> None:
    parity = _compare_against_reference([], {"evaluations": [_case("case-a", _result("single", "transition-a"))]})

    assert _exit_code_for_parity(parity) == 1


def test_parity_exit_code_fails_on_unexpected_mismatch() -> None:
    adapter = [_case("case-a", _result("single", "transition-a", auto_advanced=False))]
    reference = [
        _case(
            "case-a",
            _result("single", "transition-a", auto_advanced=True, event_time=0.1),
        )
    ]
    parity = _compare_against_reference(adapter, {"evaluations": reference})

    assert parity["unexpected_adapter_mismatch_count"] == 1
    assert _exit_code_for_parity(parity) == 1


def test_parity_exit_code_allows_only_expected_activation_differences() -> None:
    active_from = 10.0
    one_sample_before = active_from - (1.0 / 16000.0)
    adapter = [
        _case(
            "case-a",
            _result("single", "transition-a", auto_advanced=False, active_from=active_from),
        )
    ]
    reference = [
        _case(
            "case-a",
            _result(
                "single",
                "transition-a",
                auto_advanced=True,
                active_from=active_from,
                event_time=one_sample_before,
            ),
        )
    ]
    parity = _compare_against_reference(adapter, {"evaluations": reference})

    assert parity["expected_activation_contract_difference_count"] == 1
    assert _exit_code_for_parity(parity) == 0


def test_adapter_config_validation_fails_when_policy_threshold_does_not_match() -> None:
    policy = _policy_artifact()
    policy["policy"]["target_onset_min"] = 0.25

    with pytest.raises(ValueError, match="target_onset_min"):
        _adapter_config_from_policy(policy)


def test_adapter_config_validation_accepts_frozen_policy_fields() -> None:
    config = _adapter_config_from_policy(_policy_artifact())

    assert config.onset_threshold == 0.2
    assert config.frame_threshold == 0.2
    assert config.local_pre_seconds == 0.05
    assert config.local_post_seconds == 0.12


def _case(case_id: str, *results: dict[str, object]) -> dict[str, object]:
    return {
        "case_id": case_id,
        "case_kind": "correct_single",
        "source_identity": {"source_recording_id": "source-1"},
        "results_by_event_rule": {"temporally_bound": list(results)},
    }


def _result(
    family: str,
    transition_key: str,
    *,
    auto_advanced: bool = False,
    active_from: float = 0.0,
    event_time: float | None = None,
    event_times: tuple[float, ...] | None = None,
    second_classification: str | None = None,
) -> dict[str, object]:
    match = None
    if event_times is not None:
        match = {
            "latest_event_time": max(event_times),
            "events": [{"event_time": value} for value in event_times],
        }
    elif event_time is not None:
        match = {
            "latest_event_time": event_time,
            "events": [{"event_time": event_time}],
        }
    return {
        "family": family,
        "transition_key": transition_key,
        "active_from": active_from,
        "auto_advanced": auto_advanced,
        "false_automatic_advance": False,
        "missed_expected_advance": not auto_advanced,
        "second_classification": second_classification,
        "first_advance_established": None,
        "match": match,
        "score_case": {
            "family": family,
            "transition_key": transition_key,
            "target_time": active_from,
        },
    }


def _policy_artifact() -> dict[str, object]:
    return {
        "policy": {
            "target_onset_min": 0.2,
            "target_frame_min": 0.2,
            "competitor_margins_enabled": False,
            "chord_timing_spread_enabled": False,
        },
        "benchmark_window": {
            "local_pre_seconds": 0.05,
            "local_post_seconds": 0.12,
        },
    }
