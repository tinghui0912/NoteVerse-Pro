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
    result = {
        "scope": "step_microphone_frontend_global_rule_calibration",
        "frozen_evaluation_used": False,
        "reports": [str(path) for path in args.report],
        "frontends": {
            frontend: _best_policies(reports, frontend, limit=args.limit)
            for frontend in FRONTENDS
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
        candidates.append(
            {
                "policy": policy,
                "positive_recall": round(recall, 6),
                "score": score,
            }
        )
    candidates.sort(
        key=lambda item: (
            item["score"]["clean_negative_false"]["accepted"] == 0,
            -item["score"]["clean_negative_false"]["accepted"],
            item["positive_recall"],
            item["score"]["positive_acceptance"]["accepted"],
        ),
        reverse=True,
    )
    return candidates[:limit]


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
    by_kind = {kind: [0, 0] for kind in sorted(POSITIVE_KINDS | NEGATIVE_KINDS)}
    for report in reports:
        for evaluation in report["frontends"][frontend]["evaluations"]:
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
