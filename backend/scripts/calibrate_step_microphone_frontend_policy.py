"""Search tiny global STEP microphone frontend rules on non-frozen sets.

This script is research-only. It consumes existing frontend comparison reports
and must not be run against the frozen evaluation set until the policy is
chosen and frozen.
"""

from __future__ import annotations

import argparse
import itertools
import json
from pathlib import Path


POSITIVE_KINDS = {"correct_strike", "correct_chord", "same_note_retrigger"}
NEGATIVE_KINDS = {"wrong_semitone", "wrong_octave", "missing_chord_tone"}
FRONTENDS = (
    "basic_pitch_raw_activation",
    "bytedance_high_resolution_piano_transcription",
)


def main() -> int:
    args = parse_args()
    reports = [json.loads(path.read_text(encoding="utf-8")) for path in args.report]
    frontends = tuple(args.frontend or FRONTENDS)
    result = {
        "scope": "step_microphone_frontend_global_rule_calibration",
        "frozen_evaluation_used": False,
        "reports": [str(path) for path in args.report],
        "frontends": {
            frontend: _best_policies(reports, frontend, limit=args.limit)
            for frontend in frontends
        },
        "robustness": {
            frontend: _robustness_audit(reports, frontend)
            for frontend in frontends
        },
    }
    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report", type=Path, action="append", required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--frontend", action="append", choices=FRONTENDS)
    return parser.parse_args()


def _best_policies(
    reports: list[dict[str, object]],
    frontend: str,
    *,
    limit: int,
) -> list[dict[str, object]]:
    candidates = []
    for policy in _policy_grid():
        score = _score_policy(reports, frontend, policy)
        false_count = score["clean_negative_false"]["accepted"]
        positive = score["positive_acceptance"]
        recall = positive["accepted"] / positive["total"] if positive["total"] else 0.0
        balanced_recall = _balanced_positive_recall(score)
        candidates.append(
            {
                "policy": policy,
                "positive_recall": round(recall, 6),
                "balanced_positive_recall": round(balanced_recall, 6),
                "score": score,
            }
        )
    candidates.sort(key=_policy_sort_key, reverse=True)
    return candidates[:limit]


def _robustness_audit(
    reports: list[dict[str, object]],
    frontend: str,
) -> dict[str, object]:
    evaluations = _all_evaluations(reports, frontend)
    sources = sorted(
        {
            evaluation["source_identity"]["source_recording_id"]
            for evaluation in evaluations
        }
    )
    all_best = _best_policy_for_evaluations(evaluations)
    loo_folds = []
    selected_policy_counts: dict[str, int] = {}
    for held_out_source in sources:
        train = [
            evaluation
            for evaluation in evaluations
            if evaluation["source_identity"]["source_recording_id"] != held_out_source
        ]
        test = [
            evaluation
            for evaluation in evaluations
            if evaluation["source_identity"]["source_recording_id"] == held_out_source
        ]
        selected = _best_policy_for_evaluations(train)
        selected_key = json.dumps(selected["policy"], sort_keys=True)
        selected_policy_counts[selected_key] = selected_policy_counts.get(selected_key, 0) + 1
        test_score = _score_evaluations(test, selected["policy"])
        loo_folds.append(
            {
                "held_out_source_audio_sha256": held_out_source,
                "selected_policy": selected["policy"],
                "test_score": _compact_score(test_score),
            }
        )
    plateau = _policy_plateau(evaluations, all_best)
    return {
        "source_count": len(sources),
        "best_policy_on_all_non_frozen_sources": all_best,
        "leave_one_source_out": {
            "folds": loo_folds,
            "selected_policy_unique_count": len(selected_policy_counts),
            "selected_policy_counts": selected_policy_counts,
        },
        "ablation_of_best_policy": _ablation(evaluations, all_best["policy"]),
        "policy_plateau": plateau,
    }


def _policy_grid() -> list[dict[str, object]]:
    policies = []
    for frame_key, onset, frame, semitone_margin, octave_margin, spread in itertools.product(
        ("frame_activation", "frame_at_onset_peak", "frame_max_near_onset_peak"),
        (0.1, 0.2, 0.3, 0.4, 0.5, 0.6),
        (0.05, 0.1, 0.2, 0.3, 0.4),
        (-0.2, 0.0, 0.1, 0.2),
        (-0.2, 0.0, 0.1, 0.2),
        (40, 80, 120, 999),
    ):
        policies.append(
            {
                "frame_key": frame_key,
                "target_onset_min": onset,
                "target_frame_min": frame,
                "semitone_onset_margin_min": semitone_margin,
                "octave_onset_margin_min": octave_margin,
                "chord_onset_time_spread_max_ms": spread,
            }
        )
    return policies


def _score_policy(
    reports: list[dict[str, object]],
    frontend: str,
    policy: dict[str, object],
) -> dict[str, object]:
    return _score_evaluations(_all_evaluations(reports, frontend), policy)


def _all_evaluations(
    reports: list[dict[str, object]],
    frontend: str,
) -> list[dict[str, object]]:
    evaluations = []
    for report in reports:
        evaluations.extend(report["frontends"][frontend]["evaluations"])
    return evaluations


def _score_evaluations(
    evaluations: list[dict[str, object]],
    policy: dict[str, object],
) -> dict[str, object]:
    by_kind = {kind: [0, 0] for kind in sorted(POSITIVE_KINDS | NEGATIVE_KINDS)}
    for evaluation in evaluations:
        kind = evaluation["case_kind"]
        if kind not in by_kind:
            continue
        if kind in NEGATIVE_KINDS and evaluation.get("future_target_contaminated"):
            continue
        accepted = _case_accepted(evaluation, policy)
        by_kind[kind][0] += int(accepted)
        by_kind[kind][1] += 1
    positive = _sum_counts(by_kind, POSITIVE_KINDS)
    clean_negative = _sum_counts(by_kind, NEGATIVE_KINDS)
    return {
        "positive_acceptance": _count_rate(positive),
        "clean_negative_false": _count_rate(clean_negative),
        "by_kind": {kind: _count_rate(tuple(counts)) for kind, counts in by_kind.items()},
    }


def _best_policy_for_evaluations(evaluations: list[dict[str, object]]) -> dict[str, object]:
    candidates = []
    for policy in _policy_grid():
        score = _score_evaluations(evaluations, policy)
        positive = score["positive_acceptance"]
        recall = positive["accepted"] / positive["total"] if positive["total"] else 0.0
        candidates.append(
            {
                "policy": policy,
                "positive_recall": round(recall, 6),
                "balanced_positive_recall": round(_balanced_positive_recall(score), 6),
                "score": score,
            }
        )
    candidates.sort(key=_policy_sort_key, reverse=True)
    return candidates[0]


def _policy_sort_key(item: dict[str, object]) -> tuple[object, ...]:
    score = item["score"]
    return (
        score["clean_negative_false"]["accepted"] == 0,
        -score["clean_negative_false"]["accepted"],
        item["balanced_positive_recall"],
        item["positive_recall"],
        score["positive_acceptance"]["accepted"],
        _policy_simplicity_score(item["policy"]),
    )


def _balanced_positive_recall(score: dict[str, object]) -> float:
    rates = []
    for kind in ("correct_strike", "correct_chord", "same_note_retrigger"):
        rate = score["by_kind"][kind]["rate"]
        rates.append(0.0 if rate is None else float(rate))
    return min(rates)


def _policy_simplicity_score(policy: dict[str, object]) -> float:
    spread = float(policy["chord_onset_time_spread_max_ms"])
    margins = abs(float(policy["semitone_onset_margin_min"])) + abs(
        float(policy["octave_onset_margin_min"])
    )
    thresholds = float(policy["target_onset_min"]) + float(policy["target_frame_min"])
    spread_score = 0.0 if spread == 999 else -abs(spread - 80.0) / 1000.0
    return -margins - thresholds / 10.0 + spread_score


def _compact_score(score: dict[str, object]) -> dict[str, object]:
    return {
        "clean_negative_false": score["clean_negative_false"],
        "correct_single": score["by_kind"]["correct_strike"],
        "correct_chord": score["by_kind"]["correct_chord"],
        "retrigger": score["by_kind"]["same_note_retrigger"],
        "clean_semitone_false": score["by_kind"]["wrong_semitone"],
        "clean_octave_false": score["by_kind"]["wrong_octave"],
        "clean_missing_false": score["by_kind"]["missing_chord_tone"],
    }


def _ablation(
    evaluations: list[dict[str, object]],
    policy: dict[str, object],
) -> dict[str, object]:
    variants = {
        "full_rule": policy,
        "without_semitone_margin": {
            **policy,
            "semitone_onset_margin_min": -999.0,
        },
        "without_octave_margin": {
            **policy,
            "octave_onset_margin_min": -999.0,
        },
        "without_both_competitor_margins": {
            **policy,
            "semitone_onset_margin_min": -999.0,
            "octave_onset_margin_min": -999.0,
        },
        "without_chord_timing_spread": {
            **policy,
            "chord_onset_time_spread_max_ms": 999.0,
        },
    }
    return {
        name: {
            "policy": variant,
            "score": _compact_score(_score_evaluations(evaluations, variant)),
        }
        for name, variant in variants.items()
    }


def _policy_plateau(
    evaluations: list[dict[str, object]],
    best: dict[str, object],
) -> dict[str, object]:
    best_positive = best["score"]["positive_acceptance"]["accepted"]
    best_balanced = best["balanced_positive_recall"]
    members = []
    for policy in _policy_grid():
        score = _score_evaluations(evaluations, policy)
        if score["clean_negative_false"]["accepted"] != 0:
            continue
        positive = score["positive_acceptance"]["accepted"]
        if best_positive - positive <= 2:
            members.append(
                {
                    "policy": policy,
                    "positive_delta_from_best": best_positive - positive,
                    "balanced_positive_recall": round(_balanced_positive_recall(score), 6),
                    "positive_acceptance": score["positive_acceptance"],
                    "by_kind": {
                        "correct_single": score["by_kind"]["correct_strike"],
                        "correct_chord": score["by_kind"]["correct_chord"],
                        "retrigger": score["by_kind"]["same_note_retrigger"],
                    },
                }
            )
    return {
        "best_positive_acceptance": best["score"]["positive_acceptance"],
        "best_balanced_positive_recall": best_balanced,
        "zero_clean_negative_policy_count_within_two_positive_cases": len(members),
        "sample_members": members[:10],
    }


def _case_accepted(evaluation: dict[str, object], policy: dict[str, object]) -> bool:
    matched_groups = sum(
        1 for group in evaluation["group_results"] if _group_accepted(group, policy)
    )
    expected_advances = int(evaluation.get("expected_advances") or 0)
    return matched_groups > 0 if expected_advances == 0 else matched_groups >= expected_advances


def _group_accepted(group: dict[str, object], policy: dict[str, object]) -> bool:
    onset_times = []
    for pitch, evidence in group["expected_evidence"].items():
        onset = _number(evidence.get("onset_activation"))
        frame = _number(evidence.get(str(policy["frame_key"])))
        if onset is None or frame is None:
            return False
        if onset < float(policy["target_onset_min"]):
            return False
        if frame < float(policy["target_frame_min"]):
            return False
        competitors = group["competitor_evidence"].get(pitch, {})
        if not _margin_ok(
            onset,
            competitors,
            offsets=("-1", "+1"),
            required=float(policy["semitone_onset_margin_min"]),
        ):
            return False
        if not _margin_ok(
            onset,
            competitors,
            offsets=("-12", "+12"),
            required=float(policy["octave_onset_margin_min"]),
        ):
            return False
        peak_time = _number(evidence.get("onset_peak_time_relative_ms"))
        if peak_time is not None:
            onset_times.append(peak_time)
    if len(onset_times) >= 2:
        spread = max(onset_times) - min(onset_times)
        if spread > float(policy["chord_onset_time_spread_max_ms"]):
            return False
    return True


def _margin_ok(
    target_onset: float,
    competitors: dict[str, dict[str, object]],
    *,
    offsets: tuple[str, ...],
    required: float,
) -> bool:
    values = [
        _number(competitors.get(offset, {}).get("onset_activation"))
        for offset in offsets
    ]
    values = [value for value in values if value is not None]
    return not values or target_onset - max(values) >= required


def _sum_counts(
    by_kind: dict[str, list[int]],
    kinds: set[str],
) -> tuple[int, int]:
    return (
        sum(by_kind[kind][0] for kind in kinds),
        sum(by_kind[kind][1] for kind in kinds),
    )


def _count_rate(counts: tuple[int, int]) -> dict[str, object]:
    accepted, total = counts
    return {
        "accepted": accepted,
        "total": total,
        "rate": round(accepted / total, 6) if total else None,
    }


def _number(value: object) -> float | None:
    return float(value) if isinstance(value, (int, float)) else None


if __name__ == "__main__":
    raise SystemExit(main())
