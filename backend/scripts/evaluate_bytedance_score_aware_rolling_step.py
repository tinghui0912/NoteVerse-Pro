"""Research-only score-aware ByteDance rolling STEP formulation.

This benchmark asks whether ByteDance rolling onset/frame evidence can drive
STEP when the musical contract distinguishes ATTACK_REQUIRED pitches from
CONTINUATION pitches. It uses inspected development/calibration evidence only
and does not modify production parsing or progression.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path

import numpy as np

from compare_step_microphone_frontends_causal_cases import (
    ByteDancePianoTranscriptionProvider,
    _case_audio_path,
    _case_source_identity,
    _read_wav,
)
from evaluate_bytedance_direct_note_frontend import (
    _checkpoint_path,
    _sha256,
    _validate_policy,
    _warm_up_note_model,
)
from evaluate_bytedance_rolling_step_events import (
    CADENCE_SECONDS,
    EVENT_RULES,
    FUTURE_SECONDS,
    INITIALIZATION_PRE_SECONDS,
    RETRIGGER_MAX_DELTA_SECONDS,
    RETRIGGER_MIN_DELTA_SECONDS,
    SAMPLE_RATE,
    _anchor_schedule,
    _first_match,
    _run_periodic_inference,
)


PRIMARY_CASE_KINDS = {
    "correct_strike",
    "correct_chord",
    "wrong_semitone",
    "wrong_octave",
    "missing_chord_tone",
    "same_note_retrigger",
}
SAFETY_STRESS_CASE_KINDS = {
    "long_held_note_without_retrigger",
    "pedal_sustain_tail_without_retrigger",
}
GT_GROUP_WINDOW_SECONDS = 0.05


def main() -> int:
    args = parse_args()
    policy_artifact = json.loads(args.policy.read_text(encoding="utf-8"))
    _validate_policy(policy_artifact)
    policy = policy_artifact["policy"]
    frontend = policy_artifact["frontend"]
    window = policy_artifact["benchmark_window"]
    checkpoint_path = _checkpoint_path(frontend)
    checkpoint_sha256 = _sha256(checkpoint_path)
    if checkpoint_sha256 != frontend["checkpoint_sha256"]:
        raise ValueError(
            "ByteDance checkpoint SHA256 mismatch: "
            f"expected {frontend['checkpoint_sha256']}, got {checkpoint_sha256}"
        )

    cases = [
        (manifest_path, case)
        for manifest_path in args.case_manifest
        for case in json.loads(manifest_path.read_text(encoding="utf-8")).get("cases", ())
    ]

    provider = ByteDancePianoTranscriptionProvider(
        checkpoint_path=checkpoint_path,
        device=args.device,
    )
    _warm_up_note_model(provider, device=args.device)

    evaluations = [
        _evaluate_case(
            manifest_path,
            case,
            provider=provider,
            device=args.device,
            local_pre_seconds=float(window["local_pre_seconds"]),
            local_post_seconds=float(window["local_post_seconds"]),
            onset_threshold=float(policy["target_onset_min"]),
            frame_threshold=float(policy["target_frame_min"]),
            cadence_seconds=args.cadence_seconds,
        )
        for manifest_path, case in cases
    ]

    report = {
        "benchmark_scope": "bytedance_score_aware_rolling_step_dev_cal",
        "scope_wording": (
            "Research-only score-aware formulation. STEP matching is driven only "
            "by ATTACK_REQUIRED pitches. CONTINUATION pitches are recorded in the "
            "expected score position but do not require a new onset."
        ),
        "constraints": {
            "frozen_evaluation_used": False,
            "production_modified": False,
            "production_parser_modified": False,
            "threshold_tuning": False,
            "cadence_tuning": False,
            "dedupe_tuning": False,
            "velocity_or_onset_shape_rejection": False,
            "ov_or_rtt_used": False,
            "new_model_training": False,
        },
        "case_manifests": [str(path) for path in args.case_manifest],
        "case_count": len(cases),
        "bytedance": {
            "provider": frontend["provider"],
            "checkpoint_sha256": checkpoint_sha256,
            "policy": {
                "onset": float(policy["target_onset_min"]),
                "frame": float(policy["target_frame_min"]),
                "event_rules": EVENT_RULES,
                "cadence_ms": int(args.cadence_seconds * 1000),
                "future_ms": int(FUTURE_SECONDS * 1000),
            },
        },
        "summary_by_event_rule": {
            rule_name: _summary(evaluations, rule_name=rule_name)
            for rule_name in EVENT_RULES
        },
        "evaluations": evaluations,
    }

    text = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--case-manifest", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--device", default="cuda")
    parser.add_argument("--cadence-seconds", type=float, default=CADENCE_SECONDS)
    return parser.parse_args()


def _evaluate_case(
    manifest_path: Path,
    case: dict[str, object],
    *,
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
    cadence_seconds: float,
) -> dict[str, object]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE} Hz case audio, got {sample_rate}: {audio_path}")

    source_start = float((case.get("source_time_range_seconds") or (0.0,))[0])
    source_id = str(_case_source_identity(case)["source_recording_id"])
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    target_relative = tuple(max(0.0, value - source_start) for value in target_seconds)
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    actual_groups = tuple(tuple(group) for group in case.get("actual_groups", ()))
    case_kind = str(case.get("case_kind"))

    anchors = _anchor_schedule(audio_duration_seconds=audio.size / sample_rate, cadence_seconds=cadence_seconds)
    inferences, latencies = _run_periodic_inference(
        audio,
        sample_rate=sample_rate,
        anchors=anchors,
        provider=provider,
        device=device,
        local_pre_seconds=local_pre_seconds,
        local_post_seconds=local_post_seconds,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
    )

    score_cases = _score_aware_cases_from_manifest_case(
        case,
        case_kind=case_kind,
        source_recording_id=source_id,
        expected_groups=expected_groups,
        actual_groups=actual_groups,
        target_relative=target_relative,
        source_start=source_start,
    )

    results_by_rule = {}
    for rule_name, frame_rule in EVENT_RULES.items():
        results_by_rule[rule_name] = [
            _evaluate_score_case(score_case, inferences, frame_rule=frame_rule)
            for score_case in score_cases
        ]

    return {
        "case_id": case.get("case_id"),
        "case_kind": case_kind,
        "source_identity": _case_source_identity(case),
        "score_case_count": len(score_cases),
        "score_cases": score_cases,
        "results_by_event_rule": results_by_rule,
        "latency_samples": latencies,
    }


def _score_aware_cases_from_manifest_case(
    case: dict[str, object],
    *,
    case_kind: str,
    source_recording_id: str,
    expected_groups: tuple[tuple[str, ...], ...],
    actual_groups: tuple[tuple[str, ...], ...],
    target_relative: tuple[float, ...],
    source_start: float,
) -> list[dict[str, object]]:
    cases: list[dict[str, object]] = []
    if case_kind in {"correct_strike", "correct_chord"} and expected_groups and target_relative:
        cases.append(
            _target_local_score_case(
                family="single_new_attack" if case_kind == "correct_strike" else "chord_new_attack",
                expected_group=expected_groups[0],
                attack_required=expected_groups[0],
                continuation=(),
                target=target_relative[0],
                expected_auto_advance=True,
                source_case_kind=case_kind,
                diagnostic_note="All expected pitches are ATTACK_REQUIRED.",
                transition_key=f"{source_recording_id}:{source_start + target_relative[0]:.6f}",
            )
        )
    elif case_kind in {"wrong_semitone", "wrong_octave", "missing_chord_tone"} and expected_groups and target_relative:
        actual_group = actual_groups[0] if actual_groups else ()
        target_abs = source_start + target_relative[0]
        cases.append(
            _target_local_score_case(
                family="wrong_pitch" if case_kind in {"wrong_semitone", "wrong_octave"} else "missing_chord_tone",
                expected_group=expected_groups[0],
                attack_required=expected_groups[0],
                continuation=(),
                target=target_relative[0],
                expected_auto_advance=False,
                source_case_kind=case_kind,
                diagnostic_note="Counterfactual ATTACK_REQUIRED set should not auto-advance.",
                future_target_contaminated=_target_local_future_counterfactual_contaminated(
                    case,
                    expected_pitches=expected_groups[0],
                    actual_pitches=actual_group,
                    target_abs=target_abs,
                ),
                transition_key=f"{source_recording_id}:{target_abs:.6f}:{case_kind}",
            )
        )
    elif case_kind == "same_note_retrigger" and len(expected_groups) >= 2 and len(target_relative) >= 2:
        cases.append(
            {
                "family": "same_note_rearticulation",
                "source_case_kind": case_kind,
                "first_target_time": round(target_relative[0], 6),
                "second_target_time": round(target_relative[1], 6),
                "first_expected_group": expected_groups[0],
                "second_expected_group": expected_groups[1],
                "second_attack_required": expected_groups[1],
                "second_continuation": (),
                "transition_key": (
                    f"{source_recording_id}:{source_start + target_relative[0]:.6f}:"
                    f"{source_start + target_relative[1]:.6f}:same_note"
                ),
                "expected_auto_advance": True,
                "semantic_origin": "midi_note_on_gt",
                "diagnostic_note": "Second same-pitch physical note-on is ATTACK_REQUIRED.",
            }
        )
    elif case_kind in {"long_held_note_without_retrigger", "pedal_sustain_tail_without_retrigger"} and len(expected_groups) >= 2 and target_relative:
        cases.append(
            {
                "family": case_kind,
                "source_case_kind": case_kind,
                "first_target_time": round(target_relative[0], 6),
                "first_expected_group": expected_groups[0],
                "second_expected_group": expected_groups[1],
                "second_attack_required": expected_groups[1],
                "second_continuation": (),
                "transition_key": (
                    f"{source_recording_id}:{source_start + target_relative[0]:.6f}:"
                    f"{case_kind}"
                ),
                "expected_auto_advance": False,
                "semantic_origin": "safety_stress_no_retrigger",
                "diagnostic_note": "Safety stress: no second same-pitch physical note-on should auto-advance.",
            }
        )

    cases.extend(
        _adjacent_transition_score_cases(
            case,
            source_recording_id=source_recording_id,
            source_start=source_start,
        )
    )
    return cases


def _target_local_score_case(
    *,
    family: str,
    expected_group: tuple[str, ...],
    attack_required: tuple[str, ...],
    continuation: tuple[str, ...],
    target: float,
    expected_auto_advance: bool,
    source_case_kind: str,
    diagnostic_note: str,
    future_target_contaminated: bool = False,
    transition_key: str | None = None,
) -> dict[str, object]:
    return {
        "family": family,
        "source_case_kind": source_case_kind,
        "target_time": round(target, 6),
        "expected_group": expected_group,
        "attack_required": attack_required,
        "continuation": continuation,
        "expected_auto_advance": expected_auto_advance,
        "semantic_origin": "midi_note_on_gt",
        "future_target_contaminated": future_target_contaminated,
        "transition_key": transition_key,
        "diagnostic_note": diagnostic_note,
    }


def _target_local_future_counterfactual_contaminated(
    case: dict[str, object],
    *,
    expected_pitches: tuple[str, ...],
    actual_pitches: tuple[str, ...],
    target_abs: float,
) -> bool:
    counterfactual = set(expected_pitches) - set(actual_pitches)
    if not counterfactual:
        return False
    decision_end = target_abs + FUTURE_SECONDS
    for event in case.get("ground_truth_note_events", ()) or ():
        pitch = event.get("pitch")
        start = event.get("start_seconds")
        if not isinstance(pitch, str) or not isinstance(start, (int, float)):
            continue
        start = float(start)
        if target_abs + 1e-9 < start <= decision_end + 1e-9 and pitch in counterfactual:
            return True
    return False


def _adjacent_transition_score_cases(
    case: dict[str, object],
    *,
    source_recording_id: str,
    source_start: float,
) -> list[dict[str, object]]:
    groups = _gt_strike_groups(case, source_start=source_start)
    if len(groups) < 2:
        return []
    output: list[dict[str, object]] = []
    for first, second in zip(groups, groups[1:], strict=False):
        continuation = _continuation_pitches_at_group(second, case)
        attack_required = tuple(second["pitches"])
        expected_group = tuple(dict.fromkeys((*attack_required, *continuation)))
        first_pitches = set(first["pitches"])
        attack_set = set(attack_required)
        rearticulated_shared = tuple(sorted(first_pitches & attack_set, key=_pitch_sort_key))
        output.append(
            {
                "family": "adjacent_physical_transition",
                "source_case_kind": case.get("case_kind"),
                "transition_key": (
                    f"{source_recording_id}:{float(first['source_time']):.6f}:"
                    f"{float(second['source_time']):.6f}"
                ),
                "first_group_source_time": round(float(first["source_time"]), 6),
                "second_group_source_time": round(float(second["source_time"]), 6),
                "first_target_time": round(float(first["time"]), 6),
                "second_target_time": round(float(second["time"]), 6),
                "first_expected_group": tuple(first["pitches"]),
                "second_expected_group": expected_group,
                "second_attack_required": attack_required,
                "second_continuation": continuation,
                "rearticulated_shared_pitches": rearticulated_shared,
                "expected_auto_advance": True,
                "semantic_origin": "adjacent_physical_action_gt",
                "diagnostic_note": (
                    "Adjacent physical transition. ATTACK_REQUIRED comes from note-ons "
                    "in group[i+1]. CONTINUATION comes from earlier note spans still "
                    "active at group[i+1] and is not notation-tie ground truth."
                ),
            }
        )
    return output


def _gt_strike_groups(case: dict[str, object], *, source_start: float) -> list[dict[str, object]]:
    events = []
    source_end = float((case.get("source_time_range_seconds") or (0.0, 0.0))[1])
    for event in case.get("ground_truth_note_events", ()) or ():
        start = event.get("start_seconds")
        pitch = event.get("pitch")
        if not isinstance(start, (int, float)) or not isinstance(pitch, str):
            continue
        start = float(start)
        if start < source_start or start >= source_end:
            continue
        events.append(event)
    events.sort(key=lambda item: float(item["start_seconds"]))
    groups: list[dict[str, object]] = []
    for event in events:
        start = float(event["start_seconds"])
        if not groups or start - float(groups[-1]["source_time"]) > GT_GROUP_WINDOW_SECONDS:
            groups.append({"source_time": start, "time": start - source_start, "events": [event]})
        else:
            groups[-1]["events"].append(event)
    for group in groups:
        pitches = tuple(
            sorted(
                {str(event["pitch"]) for event in group["events"]},
                key=_pitch_sort_key,
            )
        )
        group["pitches"] = pitches
        group["midi_notes"] = tuple(sorted(int(event["midi_note"]) for event in group["events"]))
    return [group for group in groups if group["pitches"]]


def _continuation_pitches_at_group(
    group: dict[str, object],
    case: dict[str, object],
) -> tuple[str, ...]:
    group_time = float(group["source_time"])
    attack_pitches = set(group["pitches"])
    continuation = []
    for event in case.get("ground_truth_note_events", ()) or ():
        pitch = event.get("pitch")
        start = event.get("start_seconds")
        end = event.get("end_seconds")
        if not isinstance(pitch, str) or pitch in attack_pitches:
            continue
        if not isinstance(start, (int, float)) or not isinstance(end, (int, float)):
            continue
        if float(start) < group_time - GT_GROUP_WINDOW_SECONDS and float(end) >= group_time + 0.05:
            continuation.append(pitch)
    return tuple(sorted(set(continuation), key=_pitch_sort_key))


def _evaluate_score_case(
    score_case: dict[str, object],
    inferences: list[dict[str, object]],
    *,
    frame_rule: str,
) -> dict[str, object]:
    family = str(score_case["family"])
    if "target_time" in score_case:
        target = float(score_case["target_time"])
        match = _target_local_attack_match(
            inferences,
            tuple(score_case["attack_required"]),
            target=target,
            frame_rule=frame_rule,
        )
        auto_advanced = match is not None
        return {
            "family": family,
        "expected_auto_advance": bool(score_case["expected_auto_advance"]),
        "future_target_contaminated": bool(score_case.get("future_target_contaminated", False)),
        "transition_key": score_case.get("transition_key"),
        "auto_advanced": auto_advanced,
        "false_automatic_advance": auto_advanced and not bool(score_case["expected_auto_advance"]),
            "missed_expected_advance": (not auto_advanced) and bool(score_case["expected_auto_advance"]),
            "match": match,
            "score_case": score_case,
        }

    first = _target_local_attack_match(
        inferences,
        tuple(score_case["first_expected_group"]),
        target=float(score_case["first_target_time"]),
        frame_rule=frame_rule,
    )
    if first is None:
        return {
            "family": family,
            "first_advance_established": False,
            "auto_advanced": False,
            "false_automatic_advance": False,
            "missed_expected_advance": bool(score_case["expected_auto_advance"]),
            "score_case": score_case,
        }
    second = _first_match(
        inferences,
        tuple(score_case["second_attack_required"]),
        consumed_through_time=float(first["consumed_through_time"]),
        active_from=float(first["decision_time"]),
        active_until=None,
        event_min_time=None,
        event_max_time=None,
        frame_rule=frame_rule,
    )
    auto_advanced = second is not None
    classification = None
    if second is not None and "second_target_time" in score_case:
        delta = float(second["latest_event_time"]) - float(score_case["second_target_time"])
        if delta < RETRIGGER_MIN_DELTA_SECONDS:
            classification = "PREMATURE_FALSE_ADVANCE"
        elif delta <= RETRIGGER_MAX_DELTA_SECONDS:
            classification = "LEGITIMATE_ADVANCE"
        else:
            classification = "LATE_OR_STALE_MATCH"
    return {
        "family": family,
        "first_advance_established": True,
        "expected_auto_advance": bool(score_case["expected_auto_advance"]),
        "future_target_contaminated": bool(score_case.get("future_target_contaminated", False)),
        "transition_key": score_case.get("transition_key"),
        "auto_advanced": auto_advanced,
        "false_automatic_advance": (
            auto_advanced
            and (
                not bool(score_case["expected_auto_advance"])
                or classification == "PREMATURE_FALSE_ADVANCE"
            )
        ),
        "missed_expected_advance": (
            (not auto_advanced or classification in {"PREMATURE_FALSE_ADVANCE", "LATE_OR_STALE_MATCH"})
            and bool(score_case["expected_auto_advance"])
        ),
        "second_classification": classification,
        "first_match": first,
        "second_match": second,
        "score_case": score_case,
    }


def _target_local_attack_match(
    inferences: list[dict[str, object]],
    attack_required: tuple[str, ...],
    *,
    target: float,
    frame_rule: str,
) -> dict[str, object] | None:
    if not attack_required:
        return None
    active_from = max(0.0, target - INITIALIZATION_PRE_SECONDS)
    return _first_match(
        inferences,
        attack_required,
        consumed_through_time=active_from,
        active_from=active_from,
        active_until=target + RETRIGGER_MAX_DELTA_SECONDS,
        event_min_time=target + RETRIGGER_MIN_DELTA_SECONDS,
        event_max_time=target + RETRIGGER_MAX_DELTA_SECONDS,
        frame_rule=frame_rule,
    )


def _summary(evaluations: list[dict[str, object]], *, rule_name: str) -> dict[str, object]:
    rows = [
        result
        for evaluation in evaluations
        for result in evaluation["results_by_event_rule"][rule_name]
    ]
    primary_rows = _dedupe_primary_rows(rows)
    by_family: dict[str, list[dict[str, object]]] = defaultdict(list)
    for row in primary_rows:
        by_family[str(row["family"])].append(row)
    adjacent = by_family["adjacent_physical_transition"]
    return {
        "event_rule": {
            "name": rule_name,
            "frame_semantics": EVENT_RULES[rule_name],
        },
        "primary_product_metrics": {
            family: _family_summary(by_family[family])
            for family in (
                "single_new_attack",
                "chord_new_attack",
                "wrong_pitch",
                "missing_chord_tone",
                "same_note_rearticulation",
            )
        }
        | {
            "adjacent_all": _family_summary(adjacent),
            "adjacent_single_attack": _family_summary(
                [item for item in adjacent if len(item["score_case"]["second_attack_required"]) == 1]
            ),
            "adjacent_multi_note_attack": _family_summary(
                [item for item in adjacent if len(item["score_case"]["second_attack_required"]) > 1]
            ),
            "same_pitch_rearticulation": _family_summary(
                [
                    item for item in adjacent
                    if item["score_case"]["rearticulated_shared_pitches"]
                    and len(item["score_case"]["second_attack_required"]) == 1
                ]
            ),
            "shared_pitch_rearticulation": _family_summary(
                [item for item in adjacent if item["score_case"]["rearticulated_shared_pitches"]]
            ),
            "mixed_continuation_attack": _family_summary(
                [
                    item for item in adjacent
                    if item["score_case"]["second_continuation"]
                    and item["score_case"]["second_attack_required"]
                ]
            ),
        },
        "secondary_safety_stress": {
            family: _family_summary(by_family[family])
            for family in (
                "long_held_note_without_retrigger",
                "pedal_sustain_tail_without_retrigger",
            )
        },
        "case_counts_by_family": {
            family: len(items)
            for family, items in sorted(by_family.items())
        },
        "decision": _decision(by_family),
    }


def _dedupe_primary_rows(rows: list[dict[str, object]]) -> list[dict[str, object]]:
    seen = set()
    output = []
    for row in rows:
        family = str(row["family"])
        if family in {"long_held_note_without_retrigger", "pedal_sustain_tail_without_retrigger"}:
            output.append(row)
            continue
        key = row.get("transition_key") or row.get("score_case", {}).get("transition_key")
        if key is None:
            output.append(row)
            continue
        dedupe_key = (family, key)
        if dedupe_key in seen:
            continue
        seen.add(dedupe_key)
        output.append(row)
    return output


def _family_summary(items: list[dict[str, object]]) -> dict[str, object]:
    established = [
        item for item in items
        if item.get("first_advance_established", True)
    ]
    return {
        "total": len(items),
        "first_advance_established": _bool_rate(item.get("first_advance_established", True) for item in items),
        "auto_advance": _bool_rate(item.get("auto_advanced") for item in established),
        "false_automatic_advance": _bool_rate(item.get("false_automatic_advance") for item in established),
        "clean_false_automatic_advance": _bool_rate(
            item.get("false_automatic_advance")
            for item in established
            if not bool(item.get("future_target_contaminated"))
        ),
        "future_target_contaminated": _bool_rate(
            item.get("future_target_contaminated") for item in established
        ),
        "missed_expected_advance": _bool_rate(item.get("missed_expected_advance") for item in established),
        "second_classification_counts": dict(
            sorted(_counts(item.get("second_classification") for item in established if item.get("second_classification")).items())
        ),
    }


def _decision(by_family: dict[str, list[dict[str, object]]]) -> str:
    primary_false = sum(
        int(bool(item.get("false_automatic_advance")))
        for family in (
            "wrong_pitch",
            "missing_chord_tone",
            "same_note_rearticulation",
            "adjacent_physical_transition",
        )
        for item in by_family.get(family, ())
        if not bool(item.get("future_target_contaminated"))
    )
    useful_positive = sum(
        int(bool(item.get("auto_advanced")))
        for family in (
            "single_new_attack",
            "chord_new_attack",
            "same_note_rearticulation",
            "adjacent_physical_transition",
        )
        for item in by_family.get(family, ())
    )
    if primary_false == 0 and useful_positive > 0:
        return "ByteDance score-aware rolling STEP = KEEP_CANDIDATE_FORMULATION"
    return "ByteDance score-aware rolling STEP = NEEDS_MORE_FORMULATION_WORK"


def _bool_rate(values: object) -> dict[str, object]:
    materialized = list(values)
    total = len(materialized)
    accepted = sum(1 for value in materialized if bool(value))
    return {"accepted": accepted, "total": total, "rate": round(accepted / total, 6) if total else None}


def _counts(values: object) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for value in values:
        counts[str(value)] += 1
    return counts


def _pitch_sort_key(pitch: str) -> int:
    names = ("C#", "D#", "F#", "G#", "A#", "C", "D", "E", "F", "G", "A", "B")
    pitch_class_order = {
        "C": 0,
        "C#": 1,
        "D": 2,
        "D#": 3,
        "E": 4,
        "F": 5,
        "F#": 6,
        "G": 7,
        "G#": 8,
        "A": 9,
        "A#": 10,
        "B": 11,
    }
    for index, name in enumerate(names):
        if pitch.startswith(name):
            return (int(pitch[len(name):]) + 1) * 12 + pitch_class_order[name]
    return 999


if __name__ == "__main__":
    raise SystemExit(main())
