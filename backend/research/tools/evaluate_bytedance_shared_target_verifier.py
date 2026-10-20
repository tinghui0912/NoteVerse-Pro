"""Evaluate ByteDance as a shared target-local verifier on dev/cal cases.

This research-only harness answers a different question from the rejected
generic Continuous transcription gate: given expected pitches and a target time,
does the raw note_model evidence verify that target? It does not modify
production manifests and does not use the frozen evaluation set.
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
    _case_audio_path,
    _evaluate_expected,
    _read_wav,
)
from evaluate_bytedance_direct_note_frontend import (
    _direct_note_forward,
    _sha256,
    _sync,
    _warm_up_note_model,
)


DEFAULT_CONTEXT_MS = (1820, 3000, 5000, 10000)
DEFAULT_FUTURE_MS = (220, 350)
DEFAULT_CONTINUOUS_OFFSETS_MS = (-250, -200, -150, -100, -50, 0, 50, 100, 150, 200, 250)
DEFAULT_STEP_CANDIDATE_OFFSETS_MS = (-120, -80, -40, 0, 50)
POSITIVE_KINDS = {"correct_strike", "correct_chord", "same_note_retrigger"}


def main() -> int:
    args = parse_args()
    git_head = args.git_head or _git_head()
    policy = json.loads(args.policy.read_text(encoding="utf-8"))
    frontend = policy["frontend"]
    checkpoint_path = args.checkpoint or _checkpoint_path(frontend)
    checkpoint_sha = _sha256(checkpoint_path)
    if checkpoint_sha != frontend["checkpoint_sha256"]:
        raise ValueError(
            "checkpoint SHA256 mismatch: "
            f"expected {frontend['checkpoint_sha256']}, got {checkpoint_sha}"
        )

    cases = load_cases(args.case_manifest, max_cases_per_kind=args.max_cases_per_kind)
    provider = ByteDancePianoTranscriptionProvider(checkpoint_path=checkpoint_path, device=args.device)
    _warm_up_note_model(provider, device=args.device)

    context_ms_values = tuple(args.context_ms or DEFAULT_CONTEXT_MS)
    future_ms_values = tuple(args.future_ms or DEFAULT_FUTURE_MS)
    continuous_offsets = tuple(args.continuous_offset_ms or DEFAULT_CONTINUOUS_OFFSETS_MS)
    step_offsets = tuple(args.step_candidate_offset_ms or DEFAULT_STEP_CANDIDATE_OFFSETS_MS)
    window = policy["benchmark_window"]
    frozen_policy = policy["policy"]

    evaluations: list[dict[str, Any]] = []
    for manifest_path, case in cases:
        evaluations.extend(evaluate_case(
            manifest_path,
            case,
            provider=provider,
            device=args.device,
            context_ms_values=context_ms_values,
            future_ms_values=future_ms_values,
            continuous_offsets=continuous_offsets,
            step_offsets=step_offsets,
            local_pre_seconds=float(window["local_pre_seconds"]),
            local_post_seconds=float(window["local_post_seconds"]),
            onset_threshold=float(frozen_policy["target_onset_min"]),
            frame_threshold=float(frozen_policy["target_frame_min"]),
        ))

    report = {
        "artifact": "bytedance_shared_target_verifier_context_matrix",
        "generatedAt": args.generated_at,
        "gitHead": git_head,
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
        "caseManifests": [
            {"path": str(path), "sha256": _sha256(path)}
            for path in args.case_manifest
        ],
        "frozenEvaluationUsed": False,
        "device": args.device,
        "contextMs": list(context_ms_values),
        "futureMs": list(future_ms_values),
        "continuousOffsetsMs": list(continuous_offsets),
        "stepCandidateOffsetsMs": list(step_offsets),
        "caseCount": len(cases),
        "caseKindCounts": dict(Counter(case.get("case_kind") for _, case in cases)),
        "summary": summarize(evaluations),
        "evaluations": evaluations if args.include_evaluations else [],
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
    parser.add_argument("--checkpoint", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--max-cases-per-kind", type=int, default=None)
    parser.add_argument("--context-ms", type=int, action="append", default=None)
    parser.add_argument("--future-ms", type=int, action="append", default=None)
    parser.add_argument("--continuous-offset-ms", type=int, action="append", default=None)
    parser.add_argument("--step-candidate-offset-ms", type=int, action="append", default=None)
    parser.add_argument("--include-evaluations", action="store_true")
    parser.add_argument("--generated-at", default="2026-10-05T00:00:00+08:00")
    parser.add_argument("--git-head", default=None)
    args = parser.parse_args()
    args.raw_argv = sys.argv
    return args


def load_cases(
    manifest_paths: list[Path],
    *,
    max_cases_per_kind: int | None,
) -> list[tuple[Path, dict[str, Any]]]:
    selected: list[tuple[Path, dict[str, Any]]] = []
    counts: Counter[str] = Counter()
    for manifest_path in manifest_paths:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for case in manifest.get("cases", ()):
            kind = str(case.get("case_kind"))
            if max_cases_per_kind is not None and counts[kind] >= max_cases_per_kind:
                continue
            selected.append((manifest_path, case))
            counts[kind] += 1
    return selected


def evaluate_case(
    manifest_path: Path,
    case: dict[str, Any],
    *,
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    context_ms_values: tuple[int, ...],
    future_ms_values: tuple[int, ...],
    continuous_offsets: tuple[int, ...],
    step_offsets: tuple[int, ...],
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
) -> list[dict[str, Any]]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    source_start = float((case.get("source_time_range_seconds") or (0.0,))[0])
    expected_groups = tuple(tuple(group) for group in case.get("expected_groups", ()))
    actual_groups = tuple(tuple(group) for group in case.get("actual_groups", ()))
    target_seconds = tuple(float(value) for value in case.get("target_group_seconds", ()))
    rows: list[dict[str, Any]] = []

    for group_index, expected_pitches in enumerate(expected_groups):
        physical_target_second = target_seconds[group_index] if group_index < len(target_seconds) else source_start + 1.0
        actual_pitches = actual_groups[group_index] if group_index < len(actual_groups) else ()
        for context_ms in context_ms_values:
            for future_ms in future_ms_values:
                for mode_name, offsets in (("CONTINUOUS", continuous_offsets), ("STEP", step_offsets)):
                    for offset_ms in offsets:
                        if mode_name == "CONTINUOUS":
                            # actual = expected + offset
                            verifier_target_second = physical_target_second - offset_ms / 1000.0
                        else:
                            # candidate timestamp error = candidate - actual
                            verifier_target_second = physical_target_second + offset_ms / 1000.0
                        rows.append(evaluate_group(
                            case,
                            audio,
                            sample_rate,
                            source_start=source_start,
                            group_index=group_index,
                            expected_pitches=expected_pitches,
                            actual_pitches=actual_pitches,
                            physical_target_second=physical_target_second,
                            verifier_target_second=verifier_target_second,
                            mode_name=mode_name,
                            offset_ms=offset_ms,
                            context_ms=context_ms,
                            future_ms=future_ms,
                            provider=provider,
                            device=device,
                            local_pre_seconds=local_pre_seconds,
                            local_post_seconds=local_post_seconds,
                            onset_threshold=onset_threshold,
                            frame_threshold=frame_threshold,
                        ))
    return rows


def evaluate_group(
    case: dict[str, Any],
    audio: np.ndarray,
    sample_rate: int,
    *,
    source_start: float,
    group_index: int,
    expected_pitches: tuple[str, ...],
    actual_pitches: tuple[str, ...],
    physical_target_second: float,
    verifier_target_second: float,
    mode_name: str,
    offset_ms: int,
    context_ms: int,
    future_ms: int,
    provider: ByteDancePianoTranscriptionProvider,
    device: str,
    local_pre_seconds: float,
    local_post_seconds: float,
    onset_threshold: float,
    frame_threshold: float,
) -> dict[str, Any]:
    clip_end_abs = verifier_target_second + future_ms / 1000.0
    clip_start_abs = clip_end_abs - context_ms / 1000.0
    clip_start_rel = max(0.0, clip_start_abs - source_start)
    clip_end_rel = min(audio.size / sample_rate, clip_end_abs - source_start)
    if clip_end_rel <= clip_start_rel:
        return base_row(case, group_index, mode_name, offset_ms, context_ms, future_ms, expected_pitches, actual_pitches) | {
            "status": "NO_AUDIO_WINDOW",
        }
    clip_audio = audio[int(round(clip_start_rel * sample_rate)): int(round(clip_end_rel * sample_rate))]
    started = perf_counter()
    raw_output, forward_latency = _direct_note_forward(provider, clip_audio, sample_rate, device=device)
    _sync(device)
    elapsed_ms = (perf_counter() - started) * 1000.0
    prediction = _activation_prediction(
        raw_output,
        expected_pitches=expected_pitches,
        clip_start_seconds=source_start + clip_start_rel,
        analysis_start_seconds=verifier_target_second - local_pre_seconds,
        analysis_end_seconds=verifier_target_second + local_post_seconds,
        target_second=verifier_target_second,
        onset_threshold=onset_threshold,
        frame_threshold=frame_threshold,
    )
    observed = tuple(
        pitch
        for pitch, evidence in prediction["expected_evidence"].items()
        if evidence["accepted"]
    )
    result, matched, missing, extra = _evaluate_expected(expected_pitches, observed)
    return base_row(case, group_index, mode_name, offset_ms, context_ms, future_ms, expected_pitches, actual_pitches) | {
        "status": "OK",
        "physicalTargetSecond": round(physical_target_second, 6),
        "verifierTargetSecond": round(verifier_target_second, 6),
        "clipStartSecond": round(source_start + clip_start_rel, 6),
        "clipEndSecond": round(source_start + clip_end_rel, 6),
        "observedPitches": list(observed),
        "result": result,
        "matchedExpected": list(matched),
        "missingExpected": list(missing),
        "extraObserved": list(extra),
        "accepted": result == "MATCH",
        "expectedEvidence": prediction["expected_evidence"],
        "chordSummary": prediction["chord_summary"],
        "forwardMs": round(float(forward_latency["forward_ms"]), 3),
        "endToEndMs": round(elapsed_ms, 3),
    }


def base_row(
    case: dict[str, Any],
    group_index: int,
    mode_name: str,
    offset_ms: int,
    context_ms: int,
    future_ms: int,
    expected_pitches: tuple[str, ...],
    actual_pitches: tuple[str, ...],
) -> dict[str, Any]:
    return {
        "caseId": case.get("case_id"),
        "caseKind": case.get("case_kind"),
        "groupIndex": group_index,
        "mode": mode_name,
        "offsetMs": offset_ms,
        "contextMs": context_ms,
        "futureMs": future_ms,
        "expectedPitches": list(expected_pitches),
        "actualPitches": list(actual_pitches),
        "positiveFamily": str(case.get("case_kind")) in POSITIVE_KINDS,
    }


def summarize(rows: list[dict[str, Any]]) -> dict[str, Any]:
    buckets: dict[tuple[Any, ...], list[dict[str, Any]]] = defaultdict(list)
    for row in rows:
        buckets[(row.get("mode"), row.get("contextMs"), row.get("futureMs"), row.get("caseKind"))].append(row)
    summary = []
    for (mode_name, context_ms, future_ms, case_kind), group_rows in sorted(buckets.items(), key=str):
        ok = [row for row in group_rows if row.get("status") == "OK"]
        positives = [row for row in ok if row.get("positiveFamily")]
        negatives = [row for row in ok if not row.get("positiveFamily")]
        summary.append({
            "mode": mode_name,
            "contextMs": context_ms,
            "futureMs": future_ms,
            "caseKind": case_kind,
            "okCount": len(ok),
            "positiveRecall": ratio(sum(1 for row in positives if row.get("accepted")), len(positives)),
            "negativeFalseMatchRate": ratio(sum(1 for row in negatives if row.get("accepted")), len(negatives)),
            "medianForwardMs": percentile([float(row["forwardMs"]) for row in ok], 50),
            "p95ForwardMs": percentile([float(row["forwardMs"]) for row in ok], 95),
        })
    return {"buckets": summary}


def ratio(numerator: int, denominator: int) -> float | None:
    return None if denominator == 0 else round(numerator / denominator, 6)


def percentile(values: list[float], pct: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = min(len(ordered) - 1, max(0, int(round((pct / 100.0) * (len(ordered) - 1)))))
    return round(ordered[index], 3)


def _checkpoint_path(frontend: dict[str, Any]) -> Path:
    configured = frontend.get("checkpoint_path")
    if configured:
        return Path(str(configured))
    if frontend.get("model_id") == "CRNN_note_F1_0.9677_pedal_F1_0.9186":
        return Path("models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth")
    raise ValueError("policy artifact must provide a supported checkpoint identity")


def _git_head() -> str | None:
    import subprocess
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    except Exception:
        return None


if __name__ == "__main__":
    raise SystemExit(main())
