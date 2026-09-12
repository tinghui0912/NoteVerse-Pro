"""Run the frozen STEP microphone frontend policy exactly once.

This research-only script consumes a frozen policy artifact and a case manifest.
It evaluates only the policy/provider named by the artifact. It does not perform
grid search, policy selection, or production runtime changes.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import json
from pathlib import Path

from compare_step_microphone_frontends_causal_cases import (
    ByteDancePianoTranscriptionProvider,
    _evaluate_raw_activation_case,
    _raw_activation_frontend_report,
)


def main() -> int:
    args = parse_args()
    policy_artifact = json.loads(args.policy.read_text(encoding="utf-8"))
    if policy_artifact.get("status") != "frozen_before_evaluation":
        raise ValueError("policy artifact must be frozen_before_evaluation")
    frontend = policy_artifact["frontend"]
    policy = policy_artifact["policy"]
    window = policy_artifact["benchmark_window"]

    manifest = json.loads(args.case_manifest.read_text(encoding="utf-8"))
    cases = tuple(manifest.get("cases", ()))
    checkpoint_path = Path(str(frontend["checkpoint_path"]))
    provider = ByteDancePianoTranscriptionProvider(
        checkpoint_path=checkpoint_path,
        device=args.device,
    )
    provider_id = str(frontend["provider_id"])
    evaluations = [
        _evaluate_raw_activation_case(
            case,
            manifest_path=args.case_manifest,
            work_dir=args.work_dir,
            horizon_seconds=float(window["decision_horizon_seconds"]),
            local_pre_seconds=float(window["local_pre_seconds"]),
            local_post_seconds=float(window["local_post_seconds"]),
            onset_threshold=float(policy["target_onset_min"]),
            frame_threshold=float(policy["target_frame_min"]),
            provider_id=provider_id,
            provider=provider,
        )
        for case in cases
    ]
    report = {
        "benchmark_scope": "step_microphone_frozen_frontend_policy_evaluation",
        "frozen_policy_artifact": str(args.policy),
        "case_manifest": str(args.case_manifest),
        "grid_search": False,
        "policy_reselected": False,
        "production_modified": False,
        "frontend": _raw_activation_frontend_report(
            provider_id=provider_id,
            model_path=provider.checkpoint_path,
            thresholds={
                "reg_onset": float(policy["target_onset_min"]),
                "frame": float(policy["target_frame_min"]),
                "horizon_seconds": float(window["decision_horizon_seconds"]),
                "local_pre_seconds": float(window["local_pre_seconds"]),
                "local_post_seconds": float(window["local_post_seconds"]),
                "semitone_margin": policy.get("semitone_onset_margin_min"),
                "octave_margin": policy.get("octave_onset_margin_min"),
                "chord_onset_time_spread_max_ms": policy.get(
                    "chord_onset_time_spread_max_ms"
                ),
            },
            extra_metadata={
                "raw_outputs": frontend.get("raw_outputs_used"),
                "checkpoint_sha256": frontend.get("checkpoint_sha256"),
                "bounded_causal_prefix": True,
                "true_streaming_causal": False,
                "per_source_metrics": _per_source_metrics(evaluations),
            },
            evaluations=evaluations,
        ),
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
    parser.add_argument("--case-manifest", type=Path, required=True)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--work-dir", type=Path, required=True)
    parser.add_argument("--device", default="cuda")
    return parser.parse_args()


def _per_source_metrics(evaluations: list[dict[str, object]]) -> dict[str, object]:
    by_source: dict[str, list[dict[str, object]]] = defaultdict(list)
    for evaluation in evaluations:
        source = evaluation["source_identity"]["source_recording_id"]
        by_source[str(source)].append(evaluation)
    return {
        source: _metrics_for(source_evaluations)
        for source, source_evaluations in sorted(by_source.items())
    }


def _metrics_for(evaluations: list[dict[str, object]]) -> dict[str, object]:
    by_kind: dict[str, list[dict[str, object]]] = defaultdict(list)
    for evaluation in evaluations:
        by_kind[str(evaluation["case_kind"])].append(evaluation)
    return {
        "correct_single": _rate(by_kind["correct_strike"]),
        "correct_chord": _rate(by_kind["correct_chord"]),
        "retrigger": _rate(by_kind["same_note_retrigger"]),
        "clean_semitone_false": _rate(
            evaluation
            for evaluation in by_kind["wrong_semitone"]
            if not bool(evaluation["future_target_contaminated"])
        ),
        "clean_octave_false": _rate(
            evaluation
            for evaluation in by_kind["wrong_octave"]
            if not bool(evaluation["future_target_contaminated"])
        ),
        "clean_missing_false": _rate(
            evaluation
            for evaluation in by_kind["missing_chord_tone"]
            if not bool(evaluation["future_target_contaminated"])
        ),
    }


def _rate(evaluations: object) -> dict[str, object]:
    items = tuple(evaluations)
    accepted = sum(1 for evaluation in items if bool(evaluation["accepted"]))
    total = len(items)
    return {
        "accepted": accepted,
        "total": total,
        "rate": round(accepted / total, 6) if total else None,
    }


if __name__ == "__main__":
    raise SystemExit(main())
