"""Corrected shared target-local verifier gate for ByteDance.

This research-only harness fixes the Phase 6 semantic mistakes:
- target instances carry explicit shouldMatch ground truth;
- no missing physical target timestamp is synthesized;
- Continuous uses product legalEarly/legalLate windows;
- requested long context must be physically present or the row is excluded;
- per-offset and per-ground-truth aggregates are preserved.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import json
import platform
from pathlib import Path
import sys
from time import perf_counter
from typing import Any

import numpy as np

from compare_step_microphone_frontends_causal_cases import (
    ByteDancePianoTranscriptionProvider,
    _activation_prediction,
    _evaluate_expected,
    _read_wav,
)
from evaluate_bytedance_direct_note_frontend import (
    _direct_note_forward,
    _sha256,
    _sync,
    _warm_up_note_model,
)


CAUSAL_FAMILY_BY_KIND = {
    "correct_strike": "correct_single",
    "correct_chord": "correct_chord",
    "same_note_retrigger": "same_note_retrigger",
    "wrong_semitone": "wrong_semitone",
    "wrong_octave": "wrong_octave",
    "missing_chord_tone": "missing_chord_tone",
    "long_held_note_without_retrigger": "long_held_no_retrigger",
    "pedal_sustain_tail_without_retrigger": "pedal_sustain_no_retrigger",
}

TRUSTED_DATASET_FAMILY_BY_CATEGORY = {
    "single_note": "correct_single",
    "chord": "correct_single",
    "same_note_retrigger": "same_note_retrigger",
    "dense_repeated_pitch": "dense_repeated_pitch",
    "fast_scale_adjacent_pitches": "fast_adjacent_pitch",
    "partial_overlapping_notes": "partial_overlapping_notes",
    "soft_attack": "soft_attack",
    "loud_attack": "loud_attack",
}


def main() -> int:
    args = parse_args()
    policy = json.loads(args.policy.read_text(encoding="utf-8"))
    checkpoint_path = args.checkpoint or resolve_checkpoint_path(policy)
    checkpoint_sha = _sha256(checkpoint_path)
    expected_sha = policy["model"]["checkpointSha256"]
    if checkpoint_sha != expected_sha:
        raise ValueError(f"checkpoint SHA mismatch: expected {expected_sha}, got {checkpoint_sha}")

    targets = build_targets(
        causal_manifests=args.causal_manifest,
        trusted_dataset=args.trusted_dataset,
        policy=policy,
        max_targets_per_family=args.max_targets_per_family,
    )

    provider = ByteDancePianoTranscriptionProvider(checkpoint_path=checkpoint_path, device=args.device)
    _warm_up_note_model(provider, device=args.device)

    rows = evaluate_targets(
        targets,
        provider=provider,
        device=args.device,
        policy=effective_policy(policy, args),
    )
    report = {
        "artifact": "bytedance_target_verifier_dev_v2" if args.split == "development" else "bytedance_target_verifier_calibration_v2",
        "generatedAt": args.generated_at,
        "gitHead": args.git_head or git_head(),
        "command": " ".join(args.raw_argv),
        "os": platform.platform(),
        "checkpoint": {
            "path": str(checkpoint_path),
            "sha256": checkpoint_sha,
            "byteSize": checkpoint_path.stat().st_size,
        },
        "policy": {
            "path": str(args.policy),
            "sha256": _sha256(args.policy),
        },
        "sourceManifests": source_manifest_metadata(args, policy),
        "frozenEvaluationUsed": False,
        "split": args.split,
        "targetInstanceCount": len(targets),
        "targetFamilyCounts": dict(Counter(target["family"] for target in targets)),
        "requiredFamilyCoverage": required_family_coverage(policy, targets),
        "summary": summarize(rows),
        "contextTable": context_table(rows),
        "futureContextTable": future_context_table(rows),
        "crossModeAgreement": cross_mode_agreement(rows),
        "rows": rows,
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
    parser.add_argument("--causal-manifest", type=Path, action="append", default=[])
    parser.add_argument("--trusted-dataset", type=Path, default=None)
    parser.add_argument("--checkpoint", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--split", choices=("development", "calibration"), required=True)
    parser.add_argument("--max-targets-per-family", type=int, default=None)
    parser.add_argument("--context-ms", type=int, action="append", default=None)
    parser.add_argument("--future-ms", type=int, action="append", default=None)
    parser.add_argument("--continuous-offset-ms", type=int, action="append", default=None)
    parser.add_argument("--step-candidate-offset-ms", type=int, action="append", default=None)
    parser.add_argument("--generated-at", default="2026-10-05T00:00:00+08:00")
    parser.add_argument("--git-head", default=None)
    args = parser.parse_args()
    args.raw_argv = sys.argv
    return args


def effective_policy(policy: dict[str, Any], args: argparse.Namespace) -> dict[str, Any]:
    updated = json.loads(json.dumps(policy))
    if args.context_ms is not None:
        updated["contextsMs"] = args.context_ms
    if args.future_ms is not None:
        updated["futureContextMs"] = args.future_ms
    if args.continuous_offset_ms is not None:
        updated["continuousOffsetsMs"] = args.continuous_offset_ms
    if args.step_candidate_offset_ms is not None:
        updated["stepCandidateOffsetsMs"] = args.step_candidate_offset_ms
    return updated


def build_targets(
    *,
    causal_manifests: list[Path],
    trusted_dataset: Path | None,
    policy: dict[str, Any],
    max_targets_per_family: int | None,
) -> list[dict[str, Any]]:
    targets: list[dict[str, Any]] = []
    for manifest_path in causal_manifests:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for case in manifest.get("cases", ()):
            targets.extend(targets_from_causal_case(case, manifest_path=manifest_path, policy=policy))
    if trusted_dataset is not None:
        dataset = json.loads(trusted_dataset.read_text(encoding="utf-8"))
        for target in dataset.get("targets", ()):
            family = TRUSTED_DATASET_FAMILY_BY_CATEGORY.get(str(target.get("category")))
            if family is None:
                continue
            targets.append({
                "targetId": f"trusted:{target['targetId']}",
                "caseId": target.get("caseId"),
                "caseKind": target.get("caseKind"),
                "family": family,
                "groundTruthClass": "PHYSICAL_EXPECTED_ATTACK",
                "shouldMatch": True,
                "expectedPitches": [target["pitch"]],
                "actualPitches": [target["pitch"]],
                "sourceFile": target.get("sourceFile"),
                "sourceAudioSha256": target.get("sourceAudioSha256"),
                "physicalAttackTime": float(target["startSeconds"]),
                "scheduledExpectedTime": float(target["startSeconds"]),
                "candidateTime": float(target["startSeconds"]),
                "stressProbeTime": None,
            })
    if max_targets_per_family is None:
        return targets
    selected: list[dict[str, Any]] = []
    counts: Counter[str] = Counter()
    for target in targets:
        family = target["family"]
        if counts[family] >= max_targets_per_family:
            continue
        selected.append(target)
        counts[family] += 1
    return selected


def targets_from_causal_case(
    case: dict[str, Any],
    *,
    manifest_path: Path,
    policy: dict[str, Any],
) -> list[dict[str, Any]]:
    case_kind = str(case.get("case_kind"))
    family = CAUSAL_FAMILY_BY_KIND.get(case_kind, case_kind)
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    actual_groups = tuple(tuple(group) for group in case.get("actual_groups", ()))
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    source_file = case.get("source_file")
    targets: list[dict[str, Any]] = []
    for group_index, expected_pitches in enumerate(expected_groups):
        actual_pitches = actual_groups[group_index] if group_index < len(actual_groups) else ()
        if group_index < len(target_seconds):
            physical_time: float | None = target_seconds[group_index]
            scheduled_time = physical_time
            candidate_time = physical_time
            stress_time = None
        elif case_kind in {"long_held_note_without_retrigger", "pedal_sustain_tail_without_retrigger"} and target_seconds:
            physical_time = None
            stress_time = target_seconds[-1] + policy["stressProbes"]["noRetriggerProbeAfterPreviousPhysicalAttackMs"] / 1000.0
            scheduled_time = stress_time
            candidate_time = stress_time
        else:
            continue

        should_match = tuple(actual_pitches) == tuple(expected_pitches) and physical_time is not None
        reason = ground_truth_class(case_kind, should_match, physical_time)
        targets.append({
            "targetId": f"causal:{case.get('case_id')}:g{group_index}",
            "caseId": case.get("case_id"),
            "caseKind": case_kind,
            "family": family,
            "groundTruthClass": reason,
            "shouldMatch": should_match,
            "expectedPitches": list(expected_pitches),
            "actualPitches": list(actual_pitches),
            "sourceFile": source_file,
            "sourceAudioSha256": case.get("source_audio_sha256"),
            "manifestPath": str(manifest_path),
            "physicalAttackTime": physical_time,
            "scheduledExpectedTime": scheduled_time,
            "candidateTime": candidate_time,
            "stressProbeTime": stress_time,
        })
    return targets


def ground_truth_class(case_kind: str, should_match: bool, physical_time: float | None) -> str:
    if should_match:
        return "PHYSICAL_EXPECTED_ATTACK"
    if case_kind == "wrong_semitone":
        return "WRONG_PITCH_SEMITONE"
    if case_kind == "wrong_octave":
        return "WRONG_PITCH_OCTAVE"
    if case_kind == "missing_chord_tone":
        return "MISSING_CHORD_TONE"
    if case_kind == "long_held_note_without_retrigger":
        return "NO_RETRIGGER_SUSTAIN" if physical_time is None else "PHYSICAL_EXPECTED_ATTACK_MISMATCH"
    if case_kind == "pedal_sustain_tail_without_retrigger":
        return "PEDAL_SUSTAIN_NO_RETRIGGER" if physical_time is None else "PHYSICAL_EXPECTED_ATTACK_MISMATCH"
    return "NEGATIVE_TARGET"


def evaluate_targets(
    targets: list[dict[str, Any]],
    *,
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    policy: dict[str, Any],
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    audio_cache: dict[str, tuple[np.ndarray, int]] = {}
    for target in targets:
        audio_path = Path(str(target["sourceFile"]))
        if not audio_path.exists():
            rows.append(base_row(target, "SOURCE_AUDIO_MISSING"))
            continue
        cache_key = str(audio_path)
        if cache_key not in audio_cache:
            audio, sample_rate = _read_wav(audio_path)
            target_sample_rate = int(policy["model"]["sampleRate"])
            if sample_rate != target_sample_rate:
                audio = resample_linear(audio, sample_rate, target_sample_rate)
                sample_rate = target_sample_rate
            audio_cache[cache_key] = (audio, sample_rate)
        audio, sample_rate = audio_cache[cache_key]
        for context_ms in policy["contextsMs"]:
            for future_ms in policy["futureContextMs"]:
                for mode, offsets in (
                    ("CONTINUOUS", policy["continuousOffsetsMs"]),
                    ("STEP", policy["stepCandidateOffsetsMs"]),
                ):
                    for offset_ms in offsets:
                        rows.append(evaluate_request(
                            target,
                            audio,
                            sample_rate,
                            provider=provider,
                            device=device,
                            policy=policy,
                            context_ms=int(context_ms),
                            future_ms=int(future_ms),
                            mode=mode,
                            offset_ms=int(offset_ms),
                        ))
    return rows


def resample_linear(audio: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if source_rate <= 0 or target_rate <= 0:
        raise ValueError("sample rates must be positive")
    if audio.size == 0 or source_rate == target_rate:
        return audio.astype(np.float32, copy=False)
    duration = audio.size / float(source_rate)
    target_size = max(1, int(round(duration * target_rate)))
    source_positions = np.arange(audio.size, dtype=np.float64) / float(source_rate)
    target_positions = np.arange(target_size, dtype=np.float64) / float(target_rate)
    return np.interp(target_positions, source_positions, audio).astype(np.float32)


def evaluate_request(
    target: dict[str, Any],
    audio: np.ndarray,
    sample_rate: int,
    *,
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    policy: dict[str, Any],
    context_ms: int,
    future_ms: int,
    mode: str,
    offset_ms: int,
) -> dict[str, Any]:
    if mode == "CONTINUOUS":
        base_time = float(target["scheduledExpectedTime"])
        verifier_target_time = base_time
        physical_time = target.get("physicalAttackTime")
        if physical_time is not None and target["shouldMatch"]:
            verifier_target_time = float(physical_time) - offset_ms / 1000.0
        legal_early_ms = int(policy["timingPolicy"]["continuousLegalEarlyMs"])
        legal_late_ms = int(policy["timingPolicy"]["continuousLegalLateMs"])
    else:
        base_time = float(target["candidateTime"])
        physical_time = target.get("physicalAttackTime")
        if physical_time is not None:
            base_time = float(physical_time) + offset_ms / 1000.0
        verifier_target_time = base_time
        legal_early_ms = int(policy["timingPolicy"]["stepCandidateLegalEarlyMs"])
        legal_late_ms = int(policy["timingPolicy"]["stepCandidateLegalLateMs"])

    clip_end = verifier_target_time + future_ms / 1000.0
    clip_start = clip_end - context_ms / 1000.0
    actual_past_ms = (verifier_target_time - max(0.0, clip_start)) * 1000.0
    actual_future_ms = (min(audio.size / sample_rate, clip_end) - verifier_target_time) * 1000.0
    row = base_row(target, "OK") | {
        "mode": mode,
        "offsetMs": offset_ms,
        "requestedContextMs": context_ms,
        "requestedFutureContextMs": future_ms,
        "legalEarlyMs": legal_early_ms,
        "legalLateMs": legal_late_ms,
        "physicalAttackTime": target.get("physicalAttackTime"),
        "scheduledExpectedTime": target.get("scheduledExpectedTime"),
        "candidateTime": target.get("candidateTime"),
        "stressProbeTime": target.get("stressProbeTime"),
        "verifierTargetTime": round(verifier_target_time, 6),
        "actualPastContextMs": round(actual_past_ms, 3),
        "actualFutureContextMs": round(actual_future_ms, 3),
        "actualInputDurationMs": round(max(0.0, min(audio.size / sample_rate, clip_end) - max(0.0, clip_start)) * 1000.0, 3),
    }
    if clip_start < 0:
        return row | {"status": "INSUFFICIENT_REAL_CONTEXT"}
    if clip_end > audio.size / sample_rate:
        return row | {"status": "INSUFFICIENT_FUTURE_CONTEXT"}

    clip_audio = audio[int(round(clip_start * sample_rate)): int(round(clip_end * sample_rate))]
    started = perf_counter()
    raw_output, forward_latency = _direct_note_forward(provider, clip_audio, sample_rate, device=device)
    _sync(device)
    elapsed_ms = (perf_counter() - started) * 1000.0
    prediction = _activation_prediction(
        raw_output,
        expected_pitches=tuple(target["expectedPitches"]),
        clip_start_seconds=clip_start,
        analysis_start_seconds=verifier_target_time - legal_early_ms / 1000.0,
        analysis_end_seconds=verifier_target_time + legal_late_ms / 1000.0,
        target_second=verifier_target_time,
        onset_threshold=float(policy["thresholds"]["targetOnsetMin"]),
        frame_threshold=float(policy["thresholds"]["targetFrameMin"]),
    )
    observed = tuple(
        pitch for pitch, evidence in prediction["expected_evidence"].items() if evidence["accepted"]
    )
    result, matched, missing, extra = _evaluate_expected(tuple(target["expectedPitches"]), observed)
    accepted = result == "MATCH"
    return row | {
        "status": "OK",
        "observedExpectedPitches": list(observed),
        "accepted": accepted,
        "correctDecision": accepted == bool(target["shouldMatch"]),
        "result": result,
        "matchedExpected": list(matched),
        "missingExpected": list(missing),
        "extraObserved": list(extra),
        "pitchEvidence": compact_pitch_evidence(prediction["expected_evidence"]),
        "forwardMs": round(float(forward_latency["forward_ms"]), 3),
        "endToEndMs": round(elapsed_ms, 3),
    }


def compact_pitch_evidence(evidence: dict[str, Any]) -> dict[str, Any]:
    compact: dict[str, Any] = {}
    for pitch, values in evidence.items():
        compact[pitch] = {
            key: values.get(key)
            for key in ("accepted", "onset_score", "frame_score", "best_onset_time", "target_time_delta")
            if key in values
        }
    return compact


def base_row(target: dict[str, Any], status: str) -> dict[str, Any]:
    return {
        "status": status,
        "targetId": target.get("targetId"),
        "caseId": target.get("caseId"),
        "caseKind": target.get("caseKind"),
        "family": target.get("family"),
        "groundTruthClass": target.get("groundTruthClass"),
        "shouldMatch": target.get("shouldMatch"),
        "expectedPitches": target.get("expectedPitches"),
        "actualPitches": target.get("actualPitches"),
        "sourceFile": target.get("sourceFile"),
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    keys = ("mode", "requestedContextMs", "requestedFutureContextMs", "family", "offsetMs", "groundTruthClass")
    buckets: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        buckets[tuple(row.get(key) for key in keys)].append(row)
    summaries = []
    for key, group in sorted(buckets.items(), key=str):
        ok = [row for row in group if row.get("status") == "OK"]
        positives = [row for row in ok if row.get("shouldMatch")]
        negatives = [row for row in ok if not row.get("shouldMatch")]
        summaries.append({
            **dict(zip(keys, key, strict=True)),
            "rowCount": len(group),
            "okCount": len(ok),
            "insufficientContextCount": sum(1 for row in group if row.get("status") == "INSUFFICIENT_REAL_CONTEXT"),
            "insufficientFutureCount": sum(1 for row in group if row.get("status") == "INSUFFICIENT_FUTURE_CONTEXT"),
            "recall": ratio(sum(1 for row in positives if row.get("accepted")), len(positives)),
            "falseAcceptRate": ratio(sum(1 for row in negatives if row.get("accepted")), len(negatives)),
            "medianForwardMs": percentile([float(row["forwardMs"]) for row in ok], 50),
            "p95ForwardMs": percentile([float(row["forwardMs"]) for row in ok], 95),
        })
    return {"buckets": summaries}


def context_table(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    table = []
    for context_ms in sorted({row.get("requestedContextMs") for row in rows if row.get("requestedContextMs") is not None}):
        ok = [row for row in rows if row.get("requestedContextMs") == context_ms and row.get("status") == "OK"]
        positives = [row for row in ok if row.get("shouldMatch")]
        negatives = [row for row in ok if not row.get("shouldMatch")]
        table.append({
            "contextMs": context_ms,
            "okCount": len(ok),
            "actualInputDurationMedianMs": percentile([float(row["actualInputDurationMs"]) for row in ok], 50),
            "actualInputDurationMinMs": min([float(row["actualInputDurationMs"]) for row in ok], default=None),
            "recall": ratio(sum(1 for row in positives if row.get("accepted")), len(positives)),
            "falseAcceptRate": ratio(sum(1 for row in negatives if row.get("accepted")), len(negatives)),
            "medianForwardMs": percentile([float(row["forwardMs"]) for row in ok], 50),
            "p95ForwardMs": percentile([float(row["forwardMs"]) for row in ok], 95),
        })
    return table


def future_context_table(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    table = []
    for future_ms in sorted({row.get("requestedFutureContextMs") for row in rows if row.get("requestedFutureContextMs") is not None}):
        ok = [row for row in rows if row.get("requestedFutureContextMs") == future_ms and row.get("status") == "OK"]
        table.append({
            "futureMs": future_ms,
            "okCount": len(ok),
            "actualFutureMedianMs": percentile([float(row["actualFutureContextMs"]) for row in ok], 50),
            "actualFutureMinMs": min([float(row["actualFutureContextMs"]) for row in ok], default=None),
        })
    return table


def cross_mode_agreement(rows: list[dict[str, Any]]) -> dict[str, Any]:
    pairs: dict[tuple[Any, ...], dict[str, dict[str, Any]]] = defaultdict(dict)
    for row in rows:
        if row.get("status") != "OK" or row.get("offsetMs") != 0:
            continue
        key = (
            row.get("targetId"),
            row.get("requestedContextMs"),
            row.get("requestedFutureContextMs"),
            row.get("legalEarlyMs"),
            row.get("legalLateMs"),
        )
        pairs[key][str(row.get("mode"))] = row
    compared = 0
    decision_agree = 0
    for pair in pairs.values():
        if "STEP" not in pair or "CONTINUOUS" not in pair:
            continue
        compared += 1
        if pair["STEP"].get("accepted") == pair["CONTINUOUS"].get("accepted"):
            decision_agree += 1
    return {
        "comparedCount": compared,
        "decisionAgreement": ratio(decision_agree, compared),
        "notes": "Only identical timing-policy pairs are compared; STEP and Continuous normally use different legal windows.",
    }


def required_family_coverage(policy: dict[str, Any], targets: list[dict[str, Any]]) -> dict[str, Any]:
    counts = Counter(target["family"] for target in targets)
    return {
        family: {
            "requested": True,
            "availableCount": counts.get(family, 0),
            "represented": counts.get(family, 0) > 0,
        }
        for family in policy["requiredFamilies"]
    }


def source_manifest_metadata(args: argparse.Namespace, policy: dict[str, Any]) -> list[dict[str, Any]]:
    paths = [*args.causal_manifest]
    if args.trusted_dataset is not None:
        paths.append(args.trusted_dataset)
    return [{"path": str(path), "sha256": _sha256(path)} for path in paths]


def ratio(numerator: int, denominator: int) -> float | None:
    return None if denominator == 0 else round(numerator / denominator, 6)


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((pct / 100.0) * (len(ordered) - 1)))))
    return round(ordered[index], 3)


def resolve_checkpoint_path(policy: dict[str, Any]) -> Path:
    return Path(policy["model"]["checkpointPath"])


def git_head() -> str | None:
    import subprocess
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        return None


if __name__ == "__main__":
    raise SystemExit(main())
