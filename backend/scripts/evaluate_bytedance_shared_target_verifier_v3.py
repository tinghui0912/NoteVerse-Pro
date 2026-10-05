"""Phase 6C shared target-local verifier gate for ByteDance.

This research-only harness supersedes the v2 bounded samples for the final
shared-target gate. It fixes:
- STEP candidate-time direction;
- development/calibration split isolation;
- source audio SHA verification;
- paired long-context cohorts;
- complete-chord and second-retrigger metrics;
- deterministic gate evaluation.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
import hashlib
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
    "correct_chord": "complete_chord",
    "same_note_retrigger": "same_note_retrigger",
    "wrong_semitone": "wrong_semitone",
    "wrong_octave": "wrong_octave",
    "missing_chord_tone": "missing_chord_tone",
    "long_held_note_without_retrigger": "long_held_no_retrigger",
    "pedal_sustain_tail_without_retrigger": "pedal_sustain_no_retrigger",
}

TRUSTED_FAMILY_BY_CATEGORY = {
    "single_note": "correct_single",
    "chord": "chord_pitch_member",
    "same_note_retrigger": "same_note_retrigger_diagnostic",
    "dense_repeated_pitch": "dense_repeated_pitch",
    "fast_scale_adjacent_pitches": "fast_adjacent_pitch",
    "partial_overlapping_notes": "partial_overlapping_notes",
    "soft_attack": "soft_attack",
    "loud_attack": "loud_attack",
}


def main() -> int:
    args = parse_args()
    if args.command == "self-test":
        run_self_tests()
        return 0
    policy = load_json(args.policy)
    if args.command == "build-targets":
        report = build_target_manifest(args=args, policy=policy)
        write_report(args.output, report)
        return 0
    if args.command == "stage-a-context":
        report = run_stage_a(args=args, policy=policy)
        write_report(args.output, report)
        return 0
    if args.command == "gate-dev":
        report = run_gate(args=args, policy=policy)
        write_report(args.output, report)
        print(json.dumps(report, ensure_ascii=False, indent=2))
        return 0 if report["developmentVerdict"] == "PASS" else 2
    raise AssertionError(f"unknown command {args.command}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    def add_common(p: argparse.ArgumentParser) -> None:
        p.add_argument("--policy", type=Path, required=True)
        p.add_argument("--output", type=Path, required=True)
        p.add_argument("--generated-at", default="2026-10-05T00:00:00+08:00")
        p.add_argument("--git-head", default=None)

    p = sub.add_parser("build-targets")
    add_common(p)
    p.add_argument("--split", choices=("development", "calibration"), required=True)
    p.add_argument("--causal-manifest", type=Path, action="append", default=[])
    p.add_argument("--trusted-dataset", type=Path, required=True)

    p = sub.add_parser("stage-a-context")
    add_common(p)
    p.add_argument("--targets", type=Path, required=True)
    p.add_argument("--checkpoint", type=Path, default=None)
    p.add_argument("--device", default="cpu")

    p = sub.add_parser("gate-dev")
    add_common(p)
    p.add_argument("--stage-a", type=Path, required=True)

    sub.add_parser("self-test")
    args = parser.parse_args()
    args.raw_argv = sys.argv
    return args


def build_target_manifest(*, args: argparse.Namespace, policy: dict[str, Any]) -> dict[str, Any]:
    trusted_dataset = load_json(args.trusted_dataset)
    split_marker = f"production_step_{args.split}_set"
    targets: list[dict[str, Any]] = []

    causal_paths = {manifest_identity(path) for path in args.causal_manifest}
    for manifest_path in args.causal_manifest:
        manifest = load_json(manifest_path)
        if split_marker not in normal_path(manifest_path):
            raise ValueError(f"{args.split} build received non-{args.split} causal manifest: {manifest_path}")
        for case in manifest.get("cases", ()):
            targets.extend(targets_from_causal_case(case, manifest_path=manifest_path, policy=policy, split=args.split))

    for target in trusted_dataset.get("targets", ()):
        manifest_path = manifest_identity(target.get("manifestPath"))
        if manifest_path not in causal_paths:
            continue
        family = TRUSTED_FAMILY_BY_CATEGORY.get(str(target.get("category")))
        if family is None:
            continue
        targets.append({
            "targetId": f"trusted:{target['targetId']}",
            "source": "trusted_region_dataset",
            "split": args.split,
            "caseId": target.get("caseId"),
            "caseKind": target.get("caseKind"),
            "family": family,
            "metricFamily": family,
            "category": target.get("category"),
            "groundTruthClass": "PHYSICAL_EXPECTED_ATTACK",
            "shouldMatch": True,
            "expectedPitches": [target["pitch"]],
            "actualPitches": [target["pitch"]],
            "sourceFile": target["sourceFile"],
            "sourceAudioSha256": target.get("sourceAudioSha256"),
            "manifestPath": normal_path(target.get("manifestPath")),
            "physicalAttackTime": float(target["startSeconds"]),
            "scheduledExpectedTime": float(target["startSeconds"]),
            "candidateTime": float(target["startSeconds"]),
            "stressProbeTime": None,
            "probeMs": None,
            "groupIndex": None,
            "physicalIdentity": physical_identity(target.get("sourceAudioSha256"), [target["pitch"]], float(target["startSeconds"])),
        })

    validate_split_isolation(targets, args.split)
    verify_source_hashes(targets)
    counts = Counter(target["metricFamily"] for target in targets)
    recordings = sorted({target["sourceFile"] for target in targets})
    report = base_report(args, "bytedance_target_verifier_targets_v3") | {
        "split": args.split,
        "sourceManifests": [{"path": str(path), "sha256": _sha256(path)} for path in [*args.causal_manifest, args.trusted_dataset]],
        "targetCount": len(targets),
        "familyCounts": dict(counts),
        "requiredFamilyCoverage": {
            family: {"count": counts.get(family, 0), "represented": counts.get(family, 0) > 0}
            for family in policy["requiredFamilies"]
        },
        "uniqueSourceRecordingCount": len(recordings),
        "uniqueSourceRecordings": recordings,
        "sourceHashVerification": source_hash_summary(targets),
        "targets": targets,
    }
    return report


def targets_from_causal_case(case: dict[str, Any], *, manifest_path: Path, policy: dict[str, Any], split: str) -> list[dict[str, Any]]:
    case_kind = str(case.get("case_kind"))
    family = CAUSAL_FAMILY_BY_KIND.get(case_kind, case_kind)
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    actual_groups = tuple(tuple(group) for group in case.get("actual_groups", ()))
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    targets: list[dict[str, Any]] = []
    for group_index, expected_pitches in enumerate(expected_groups):
        actual_pitches = actual_groups[group_index] if group_index < len(actual_groups) else ()
        if group_index < len(target_seconds):
            physical_time: float | None = target_seconds[group_index]
            scheduled_time = physical_time
            candidate_time = physical_time
            stress_time = None
            probe_ms = None
        elif case_kind in {"long_held_note_without_retrigger", "pedal_sustain_tail_without_retrigger"} and target_seconds:
            for probe_ms in policy["stressProbes"]["noRetriggerProbeAfterPreviousPhysicalAttackMs"]:
                stress_time = target_seconds[-1] + float(probe_ms) / 1000.0
                targets.append(causal_target(
                    case=case,
                    manifest_path=manifest_path,
                    split=split,
                    group_index=group_index,
                    family=family,
                    expected_pitches=expected_pitches,
                    actual_pitches=actual_pitches,
                    physical_time=None,
                    scheduled_time=stress_time,
                    candidate_time=stress_time,
                    stress_time=stress_time,
                    probe_ms=int(probe_ms),
                ))
            continue
        else:
            continue
        targets.append(causal_target(
            case=case,
            manifest_path=manifest_path,
            split=split,
            group_index=group_index,
            family=family,
            expected_pitches=expected_pitches,
            actual_pitches=actual_pitches,
            physical_time=physical_time,
            scheduled_time=scheduled_time,
            candidate_time=candidate_time,
            stress_time=stress_time,
            probe_ms=probe_ms,
        ))
    return targets


def causal_target(
    *,
    case: dict[str, Any],
    manifest_path: Path,
    split: str,
    group_index: int,
    family: str,
    expected_pitches: tuple[str, ...],
    actual_pitches: tuple[str, ...],
    physical_time: float | None,
    scheduled_time: float,
    candidate_time: float,
    stress_time: float | None,
    probe_ms: int | None,
) -> dict[str, Any]:
    case_kind = str(case.get("case_kind"))
    should_match = tuple(actual_pitches) == tuple(expected_pitches) and physical_time is not None
    metric_family = metric_family_for(case_kind, group_index, physical_time, family)
    return {
        "targetId": f"causal:{case.get('case_id')}:g{group_index}" + (f":probe{probe_ms}" if probe_ms is not None else ""),
        "source": "causal_case",
        "split": split,
        "caseId": case.get("case_id"),
        "caseKind": case_kind,
        "family": family,
        "metricFamily": metric_family,
        "groundTruthClass": ground_truth_class(case_kind, should_match, physical_time),
        "shouldMatch": should_match,
        "expectedPitches": list(expected_pitches),
        "actualPitches": list(actual_pitches),
        "sourceFile": case.get("source_file"),
        "sourceAudioSha256": case.get("source_audio_sha256"),
        "manifestPath": normal_path(manifest_path),
        "physicalAttackTime": physical_time,
        "scheduledExpectedTime": scheduled_time,
        "candidateTime": candidate_time,
        "stressProbeTime": stress_time,
        "probeMs": probe_ms,
        "groupIndex": group_index,
        "physicalIdentity": physical_identity(case.get("source_audio_sha256"), actual_pitches or expected_pitches, physical_time),
    }


def metric_family_for(case_kind: str, group_index: int, physical_time: float | None, fallback: str) -> str:
    if case_kind == "same_note_retrigger":
        return "same_note_retrigger_first" if group_index == 0 else "same_note_retrigger_second"
    if case_kind == "long_held_note_without_retrigger":
        return "long_held_first_strike" if physical_time is not None else "long_held_no_retrigger"
    if case_kind == "pedal_sustain_tail_without_retrigger":
        return "pedal_first_strike" if physical_time is not None else "pedal_sustain_no_retrigger"
    return fallback


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


def run_stage_a(*, args: argparse.Namespace, policy: dict[str, Any]) -> dict[str, Any]:
    targets_report = load_json(args.targets)
    targets = targets_report["targets"]
    checkpoint_path = args.checkpoint or resolve_checkpoint_path(policy)
    checkpoint_sha = _sha256(checkpoint_path)
    if checkpoint_sha != policy["model"]["checkpointSha256"]:
        raise ValueError(f"checkpoint SHA mismatch: expected {policy['model']['checkpointSha256']}, got {checkpoint_sha}")
    provider = ByteDancePianoTranscriptionProvider(checkpoint_path=checkpoint_path, device=args.device)
    _warm_up_note_model(provider, device=args.device)
    audio_cache: dict[str, tuple[np.ndarray, int]] = {}
    paired, excluded = build_paired_context_cohort(targets, policy=policy, audio_cache=audio_cache)
    rows: list[dict[str, Any]] = []
    for target in paired:
        audio, sample_rate = load_audio(target, policy, audio_cache)
        for context_ms in policy["totalInputContextMs"]:
            rows.append(evaluate_target_request(
                target,
                audio,
                sample_rate,
                provider=provider,
                device=args.device,
                policy=policy,
                total_context_ms=int(context_ms),
                post_attack_context_ms=int(policy["stageA"]["modelPostAttackContextMs"]),
                target_time=float(target["scheduledExpectedTime"]),
                evidence_before_ms=int(policy["timingPolicy"]["continuousEvidenceBeforeExpectedMs"]),
                evidence_after_ms=int(policy["timingPolicy"]["continuousEvidenceAfterExpectedMs"]),
                stage="A_CONTEXT",
            ))
    report = base_report(args, "bytedance_target_verifier_dev_context_v3") | {
        "split": targets_report["split"],
        "stage": "A_CONTEXT",
        "policy": metadata_for_path(args.policy),
        "targets": metadata_for_path(args.targets),
        "checkpoint": {"path": str(checkpoint_path), "sha256": checkpoint_sha, "byteSize": checkpoint_path.stat().st_size},
        "pairedTargetCount": len(paired),
        "excludedForContextReason": excluded,
        "pairedTargetHash": hash_json([target["targetId"] for target in paired]),
        "pairedTargetIds": [target["targetId"] for target in paired],
        "familyCounts": dict(Counter(target["metricFamily"] for target in paired)),
        "uniquePhysicalEvents": len({target["physicalIdentity"] for target in paired if target.get("physicalIdentity")}),
        "uniqueSourceRecordingCount": len({target["sourceFile"] for target in paired}),
        "contextTable": context_table(rows),
        "familyContextTable": family_context_table(rows),
        "rows": rows,
    }
    return report


def build_paired_context_cohort(targets: list[dict[str, Any]], *, policy: dict[str, Any], audio_cache: dict[str, tuple[np.ndarray, int]]) -> tuple[list[dict[str, Any]], dict[str, int]]:
    paired: list[dict[str, Any]] = []
    excluded = Counter()
    post_ms = int(policy["stageA"]["modelPostAttackContextMs"])
    for target in targets:
        try:
            audio, sample_rate = load_audio(target, policy, audio_cache)
        except FileNotFoundError:
            excluded["SOURCE_AUDIO_MISSING"] += 1
            continue
        ok = True
        for context_ms in policy["totalInputContextMs"]:
            status = context_status(target, audio, sample_rate, total_context_ms=int(context_ms), post_attack_context_ms=post_ms, target_time=float(target["scheduledExpectedTime"]))
            if status != "OK":
                excluded[status] += 1
                ok = False
                break
        if ok:
            paired.append(target)
    return paired, dict(excluded)


def context_status(target: dict[str, Any], audio: np.ndarray, sample_rate: int, *, total_context_ms: int, post_attack_context_ms: int, target_time: float) -> str:
    clip_end = target_time + post_attack_context_ms / 1000.0
    clip_start = clip_end - total_context_ms / 1000.0
    if clip_start < 0:
        return "INSUFFICIENT_REAL_CONTEXT"
    if clip_end > audio.size / sample_rate:
        return "INSUFFICIENT_FUTURE_CONTEXT"
    physical_time = target.get("physicalAttackTime")
    if target.get("shouldMatch") and physical_time is not None:
        attack_to_clip_end_ms = (clip_end - float(physical_time)) * 1000.0
        if attack_to_clip_end_ms + 1e-6 < post_attack_context_ms:
            return "INSUFFICIENT_POST_ATTACK_CONTEXT"
    return "OK"


def evaluate_target_request(
    target: dict[str, Any],
    audio: np.ndarray,
    sample_rate: int,
    *,
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    policy: dict[str, Any],
    total_context_ms: int,
    post_attack_context_ms: int,
    target_time: float,
    evidence_before_ms: int,
    evidence_after_ms: int,
    stage: str,
) -> dict[str, Any]:
    clip_end = target_time + post_attack_context_ms / 1000.0
    clip_start = clip_end - total_context_ms / 1000.0
    row = base_row(target) | {
        "stage": stage,
        "requestedTotalContextMs": total_context_ms,
        "modelPostAttackContextMs": post_attack_context_ms,
        "historicalPastContextMs": total_context_ms - post_attack_context_ms,
        "targetTime": round(target_time, 6),
        "evidenceBeforeMs": evidence_before_ms,
        "evidenceAfterMs": evidence_after_ms,
        "actualInputDurationMs": round((clip_end - clip_start) * 1000.0, 3),
        "actualPastContextMs": round((target_time - clip_start) * 1000.0, 3),
        "actualFutureContextMs": round((clip_end - target_time) * 1000.0, 3),
        "actualAttackToClipEndMs": None,
    }
    physical_time = target.get("physicalAttackTime")
    if physical_time is not None:
        row["actualAttackToClipEndMs"] = round((clip_end - float(physical_time)) * 1000.0, 3)
    status = context_status(target, audio, sample_rate, total_context_ms=total_context_ms, post_attack_context_ms=post_attack_context_ms, target_time=target_time)
    if status != "OK":
        return row | {"status": status}
    clip_audio = audio[int(round(clip_start * sample_rate)): int(round(clip_end * sample_rate))]
    started = perf_counter()
    raw_output, forward_latency = _direct_note_forward(provider, clip_audio, sample_rate, device=device)
    _sync(device)
    elapsed_ms = (perf_counter() - started) * 1000.0
    prediction = _activation_prediction(
        raw_output,
        expected_pitches=tuple(target["expectedPitches"]),
        clip_start_seconds=clip_start,
        analysis_start_seconds=target_time - evidence_before_ms / 1000.0,
        analysis_end_seconds=target_time + evidence_after_ms / 1000.0,
        target_second=target_time,
        onset_threshold=float(policy["thresholds"]["targetOnsetMin"]),
        frame_threshold=float(policy["thresholds"]["targetFrameMin"]),
    )
    observed = tuple(pitch for pitch, evidence in prediction["expected_evidence"].items() if evidence["accepted"])
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


def run_gate(*, args: argparse.Namespace, policy: dict[str, Any]) -> dict[str, Any]:
    stage_a = load_json(args.stage_a)
    criteria = policy["acceptanceCriteria"]
    context_results = []
    for context_ms in policy["totalInputContextMs"]:
        checks = evaluate_stage_a_context(stage_a["rows"], context_ms=int(context_ms), criteria=criteria)
        context_results.append({"contextMs": context_ms, "checks": checks, "verdict": "PASS" if all(c["verdict"] == "PASS" for c in checks) else "FAIL"})
    eligible = [item for item in context_results if item["verdict"] == "PASS"]
    selected = min((item["contextMs"] for item in eligible), default=None)
    report = base_report(args, "bytedance_target_verifier_dev_gate_v3") | {
        "policy": metadata_for_path(args.policy),
        "stageA": metadata_for_path(args.stage_a),
        "contextResults": context_results,
        "selectedContextMs": selected,
        "developmentVerdict": "PASS" if selected is not None else "FAIL",
        "stopReason": None if selected is not None else "No Stage A context passed the frozen per-family gates; calibration and browser gates must not run.",
    }
    return report


def evaluate_stage_a_context(rows: list[dict[str, Any]], *, context_ms: int, criteria: dict[str, Any]) -> list[dict[str, Any]]:
    rows = [row for row in rows if row.get("requestedTotalContextMs") == context_ms and row.get("status") == "OK"]
    checks = []
    recall_map = {
        "correct_single": criteria["correctSingleRecallMin"],
        "complete_chord": criteria["completeChordRecallMin"],
        "same_note_retrigger_second": criteria["secondSameNoteRetriggerRecallMin"],
        "dense_repeated_pitch": criteria["denseRepeatedPitchRecallMin"],
        "fast_adjacent_pitch": criteria["fastAdjacentPitchRecallMin"],
        "partial_overlapping_notes": criteria["partialOverlapRecallMin"],
        "soft_attack": criteria["softAttackRecallMin"],
        "loud_attack": criteria["loudAttackRecallMin"],
    }
    for family, minimum in recall_map.items():
        fam = [row for row in rows if row.get("metricFamily") == family and row.get("shouldMatch")]
        value = ratio(sum(1 for row in fam if row.get("accepted")), len(fam))
        checks.append(check(f"{family}.recall", value, ">=", minimum, len(fam)))
    false_map = {
        "wrong_semitone": criteria["wrongSemitoneFalseAcceptMax"],
        "wrong_octave": criteria["wrongOctaveFalseAcceptMax"],
        "missing_chord_tone": criteria["missingChordCompleteFalseAcceptMax"],
        "long_held_no_retrigger": criteria["heldNoteNoRetriggerFalseAcceptMax"],
        "pedal_sustain_no_retrigger": criteria["pedalNoRetriggerFalseAcceptMax"],
    }
    for family, maximum in false_map.items():
        fam = [row for row in rows if row.get("metricFamily") == family and not row.get("shouldMatch")]
        false_count = sum(1 for row in fam if row.get("accepted"))
        checks.append(check(f"{family}.falseAcceptCount", false_count, "<=", maximum, len(fam)))
    return checks


def check(name: str, value: float | int | None, op: str, threshold: float | int, count: int) -> dict[str, Any]:
    if value is None:
        verdict = "FAIL"
    elif op == ">=":
        verdict = "PASS" if value >= threshold else "FAIL"
    elif op == "<=":
        verdict = "PASS" if value <= threshold else "FAIL"
    else:
        raise ValueError(op)
    return {"criterion": name, "value": value, "operator": op, "threshold": threshold, "sampleCount": count, "verdict": verdict}


def load_audio(target: dict[str, Any], policy: dict[str, Any], audio_cache: dict[str, tuple[np.ndarray, int]]) -> tuple[np.ndarray, int]:
    source = Path(str(target["sourceFile"]))
    if not source.exists():
        raise FileNotFoundError(source)
    key = str(source)
    if key not in audio_cache:
        audio, sample_rate = _read_wav(source)
        target_rate = int(policy["model"]["sampleRate"])
        if sample_rate != target_rate:
            audio = resample_linear(audio, sample_rate, target_rate)
            sample_rate = target_rate
        audio_cache[key] = (audio, sample_rate)
    return audio_cache[key]


def verify_source_hashes(targets: list[dict[str, Any]]) -> None:
    checked: dict[str, str] = {}
    for target in targets:
        expected = target.get("sourceAudioSha256")
        if not expected:
            continue
        source = str(target["sourceFile"])
        if source not in checked:
            checked[source] = _sha256(Path(source))
        if checked[source] != expected:
            raise ValueError(f"source SHA mismatch for {source}: expected {expected}, got {checked[source]}")


def source_hash_summary(targets: list[dict[str, Any]]) -> dict[str, int]:
    sources = {}
    missing = set()
    for target in targets:
        source = str(target["sourceFile"])
        expected = target.get("sourceAudioSha256")
        if expected:
            sources[source] = expected
        else:
            missing.add(source)
    return {"verifiedSourceCount": len(sources), "missingHashSourceCount": len(missing)}


def validate_split_isolation(targets: list[dict[str, Any]], split: str) -> None:
    expected_marker = f"production_step_{split}_set"
    wrong = [target["targetId"] for target in targets if expected_marker not in normal_path(target.get("manifestPath"))]
    if wrong:
        raise ValueError(f"{split} manifest contains targets from another split: {wrong[:5]}")


def resample_linear(audio: np.ndarray, source_rate: int, target_rate: int) -> np.ndarray:
    if audio.size == 0 or source_rate == target_rate:
        return audio.astype(np.float32, copy=False)
    duration = audio.size / float(source_rate)
    target_size = max(1, int(round(duration * target_rate)))
    source_positions = np.arange(audio.size, dtype=np.float64) / float(source_rate)
    target_positions = np.arange(target_size, dtype=np.float64) / float(target_rate)
    return np.interp(target_positions, source_positions, audio).astype(np.float32)


def context_table(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    table = []
    for context_ms in sorted({row.get("requestedTotalContextMs") for row in rows}):
        ok = [row for row in rows if row.get("requestedTotalContextMs") == context_ms and row.get("status") == "OK"]
        positives = [row for row in ok if row.get("shouldMatch")]
        negatives = [row for row in ok if not row.get("shouldMatch")]
        table.append({
            "contextMs": context_ms,
            "okCount": len(ok),
            "actualInputDurationMedianMs": percentile([float(row["actualInputDurationMs"]) for row in ok], 50),
            "actualInputDurationMinMs": min([float(row["actualInputDurationMs"]) for row in ok], default=None),
            "recallDiagnostic": ratio(sum(1 for row in positives if row.get("accepted")), len(positives)),
            "falseAcceptDiagnostic": ratio(sum(1 for row in negatives if row.get("accepted")), len(negatives)),
            "medianForwardMs": percentile([float(row["forwardMs"]) for row in ok], 50),
            "p95ForwardMs": percentile([float(row["forwardMs"]) for row in ok], 95),
        })
    return table


def family_context_table(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[tuple[Any, Any, Any], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        buckets[(row.get("requestedTotalContextMs"), row.get("metricFamily"), row.get("groundTruthClass"))].append(row)
    table = []
    for (context_ms, family, gt), group in sorted(buckets.items(), key=str):
        ok = [row for row in group if row.get("status") == "OK"]
        positives = [row for row in ok if row.get("shouldMatch")]
        negatives = [row for row in ok if not row.get("shouldMatch")]
        table.append({
            "contextMs": context_ms,
            "metricFamily": family,
            "groundTruthClass": gt,
            "rowCount": len(group),
            "okCount": len(ok),
            "recall": ratio(sum(1 for row in positives if row.get("accepted")), len(positives)),
            "falseAcceptRate": ratio(sum(1 for row in negatives if row.get("accepted")), len(negatives)),
        })
    return table


def compact_pitch_evidence(evidence: dict[str, Any]) -> dict[str, Any]:
    return {
        pitch: {
            key: values.get(key)
            for key in ("accepted", "onset_score", "frame_score", "best_onset_time", "target_time_delta")
            if key in values
        }
        for pitch, values in evidence.items()
    }


def base_row(target: dict[str, Any]) -> dict[str, Any]:
    return {
        "targetId": target.get("targetId"),
        "caseId": target.get("caseId"),
        "caseKind": target.get("caseKind"),
        "family": target.get("family"),
        "metricFamily": target.get("metricFamily"),
        "groundTruthClass": target.get("groundTruthClass"),
        "shouldMatch": target.get("shouldMatch"),
        "expectedPitches": target.get("expectedPitches"),
        "actualPitches": target.get("actualPitches"),
        "sourceFile": target.get("sourceFile"),
        "physicalAttackTime": target.get("physicalAttackTime"),
        "scheduledExpectedTime": target.get("scheduledExpectedTime"),
        "candidateTime": target.get("candidateTime"),
        "stressProbeTime": target.get("stressProbeTime"),
        "probeMs": target.get("probeMs"),
        "physicalIdentity": target.get("physicalIdentity"),
    }


def base_report(args: argparse.Namespace, artifact: str) -> dict[str, Any]:
    return {
        "artifact": artifact,
        "generatedAt": args.generated_at,
        "gitHead": args.git_head or git_head(),
        "command": " ".join(args.raw_argv),
        "os": platform.platform(),
        "frozenEvaluationUsed": False,
    }


def metadata_for_path(path: Path) -> dict[str, Any]:
    return {"path": str(path), "sha256": _sha256(path)}


def hash_json(value: Any) -> str:
    return hashlib.sha256(json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def physical_identity(source_sha: str | None, pitches: tuple[str, ...] | list[str], physical_time: float | None) -> str | None:
    if physical_time is None:
        return None
    return f"{source_sha or 'unknown'}:{'+'.join(sorted(pitches))}:{physical_time:.6f}"


def normal_path(path: Any) -> str:
    return str(path).replace("\\", "/")


def manifest_identity(path: Any) -> str:
    normalized = normal_path(path)
    marker = "data/work/datasets/"
    if marker in normalized:
        return normalized[normalized.index(marker):]
    return normalized


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


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


def run_self_tests() -> None:
    policy = {
        "timingPolicy": {
            "stepEvidenceBeforeCandidateMs": 50,
            "stepEvidenceAfterCandidateMs": 120,
        }
    }
    physical_attack = 1.0
    for delta_ms in (-120, 50):
        candidate = physical_attack + delta_ms / 1000.0
        start = candidate - policy["timingPolicy"]["stepEvidenceBeforeCandidateMs"] / 1000.0
        end = candidate + policy["timingPolicy"]["stepEvidenceAfterCandidateMs"] / 1000.0
        assert start <= physical_attack <= end, (delta_ms, start, physical_attack, end)
    target = {"scheduledExpectedTime": 3.0, "physicalAttackTime": 3.25, "shouldMatch": True}
    audio = np.zeros(5 * 16000, dtype=np.float32)
    assert context_status(target, audio, 16000, total_context_ms=1820, post_attack_context_ms=220, target_time=3.0) == "INSUFFICIENT_POST_ATTACK_CONTEXT"
    target["scheduledExpectedTime"] = 0.5
    target["physicalAttackTime"] = 0.5
    assert context_status(target, audio, 16000, total_context_ms=1820, post_attack_context_ms=220, target_time=0.5) == "INSUFFICIENT_REAL_CONTEXT"


if __name__ == "__main__":
    raise SystemExit(main())
