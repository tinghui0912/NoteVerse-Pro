"""Phase 7 RTT score-independent onset stream gate.

Research-only. The model runs once per PCM clip and emits a generic 88-key
onset stream. STEP/Continuous target questions are scored after inference from
the same stream. No production code is imported or modified.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
import platform
import subprocess
import sys
from time import perf_counter
from typing import Any

import numpy as np

from compare_step_microphone_frontends_causal_cases import _case_audio_path, _midi_note_name, _read_wav


SAMPLE_RATE = 16_000
FRAMES_PER_SECOND = 100
MIDI_OFFSET = 21


def main() -> int:
    args = parse_args()
    policy = json.loads(args.policy.read_text(encoding="utf-8"))
    repo = args.rtt_repo
    checkpoint = args.checkpoint
    _prepare_rtt_imports(repo)

    import torch
    import torchaudio
    from models import CustomAMT
    from pl_model import RTT

    noteverse_head = args.noteverse_head or _git_head(Path(__file__).resolve().parents[2])
    repo_head = _git_head(repo)
    checkpoint_sha = sha256(checkpoint)
    checkpoint_bytes = checkpoint.stat().st_size
    upstream = audit_upstream(repo, checkpoint, policy, torch=torch, torchaudio=torchaudio)
    if repo_head != policy["candidate"]["commit"]:
        upstream["identityStatus"] = "FAIL"
        upstream["identityFailure"] = f"repo HEAD {repo_head} != expected {policy['candidate']['commit']}"
    elif checkpoint_sha != policy["candidate"]["expectedCheckpointSha256"]:
        upstream["identityStatus"] = "FAIL"
        upstream["identityFailure"] = f"checkpoint sha {checkpoint_sha} != expected {policy['candidate']['expectedCheckpointSha256']}"
    elif checkpoint_bytes != int(policy["candidate"]["expectedCheckpointBytes"]):
        upstream["identityStatus"] = "FAIL"
        upstream["identityFailure"] = f"checkpoint bytes {checkpoint_bytes} != expected {policy['candidate']['expectedCheckpointBytes']}"
    else:
        upstream["identityStatus"] = "PASS"

    metadata = {
        "generatedAt": "2026-10-05T00:00:00+08:00",
        "noteVerseGitHead": noteverse_head,
        "command": " ".join(sys.argv),
        "os": platform.platform(),
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "torchaudio": torchaudio.__version__,
        "cuda": getattr(torch.version, "cuda", None),
        "cudaAvailable": bool(torch.cuda.is_available()),
        "device": args.device or ("cuda" if torch.cuda.is_available() else "cpu"),
        "frozenEvaluationUsed": False,
        "policy": {"path": str(args.policy), "sha256": sha256(args.policy)},
        "rttRepo": str(repo),
        "rttUpstreamCommit": repo_head,
        "checkpoint": {"path": str(checkpoint), "sha256": checkpoint_sha, "bytes": checkpoint_bytes},
    }

    reports: dict[str, Any] = {"metadata": metadata, "upstream": upstream}
    if upstream["identityStatus"] != "PASS":
        reports["development"] = "INCONCLUSIVE"
        reports["finalVerdict"] = "RTT Shared Streaming Onset Frontend = INCONCLUSIVE"
        reports["stopReason"] = "Upstream identity gate failed."
        write_reports(args, reports)
        return 2

    device = torch.device(metadata["device"])
    base_model = CustomAMT()
    rtt_model = RTT.load_from_checkpoint(
        model=base_model,
        loss_function="weighted_bce_mse",
        checkpoint_path=str(checkpoint),
        map_location=device,
    )
    model = rtt_model.model.to(device).eval()
    reports["upstream"]["modelParameterCount"] = int(sum(p.numel() for p in model.parameters()))

    cases = load_cases(args.case_manifest)
    selected_cases = cases[: args.limit_cases] if args.limit_cases else cases
    reports["dataset"] = {
        "caseManifestPaths": [str(path) for path in args.case_manifest],
        "caseManifestSha256": [sha256(path) for path in args.case_manifest],
        "caseCount": len(cases),
        "evaluatedCaseCount": len(selected_cases),
    }
    evaluations = []
    output_cache: dict[str, dict[str, np.ndarray]] = {}
    for manifest_path, case in selected_cases:
        evaluations.append(evaluate_case(manifest_path, case, model=model, device=device, policy=policy, output_cache=output_cache))
    reports["causalPrefixInvariance"] = prefix_invariance(selected_cases[: min(6, len(selected_cases))], model=model, device=device, policy=policy)
    reports["historicalReports"] = classify_historical_reports()
    acoustic = acoustic_summary(evaluations, policy)
    reports["developmentAcousticStream"] = acoustic
    reports["evaluations"] = evaluations

    if reports["causalPrefixInvariance"]["verdict"] != "PASS":
        reports["development"] = "INCONCLUSIVE"
        reports["calibration"] = "NOT RUN"
        reports["browser"] = "NOT RUN"
        reports["finalVerdict"] = "RTT Shared Streaming Onset Frontend = INCONCLUSIVE"
        reports["stopReason"] = "Causal prefix invariance did not pass."
    elif acoustic["verdict"] == "FAIL":
        reports["development"] = "FAIL"
        reports["calibration"] = "NOT RUN"
        reports["browser"] = "NOT RUN"
        reports["stepReplay"] = "NOT RUN"
        reports["continuousReplay"] = "NOT RUN"
        reports["incrementalRuntime"] = "NOT RUN"
        reports["finalVerdict"] = "RTT Shared Streaming Onset Frontend = FAIL"
        reports["stopReason"] = "Gate C acoustic onset stream hard criteria failed; staged stop before product replay."
    elif acoustic["verdict"] == "INCONCLUSIVE":
        reports["development"] = "INCONCLUSIVE"
        reports["calibration"] = "NOT RUN"
        reports["browser"] = "NOT RUN"
        reports["finalVerdict"] = "RTT Shared Streaming Onset Frontend = INCONCLUSIVE"
        reports["stopReason"] = "Required acoustic stream data was not fully evaluable."
    else:
        reports["development"] = "PASS"
        reports["calibration"] = "NOT RUN"
        reports["browser"] = "NOT RUN"
        reports["finalVerdict"] = "RTT Shared Streaming Onset Frontend = INCONCLUSIVE"
        reports["stopReason"] = "Acoustic stream passed Development, but product replay/calibration/incremental runtime were not executed in this script."

    write_reports(args, reports)
    return 1 if reports["development"] == "FAIL" else 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--rtt-repo", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--case-manifest", type=Path, action="append", required=True)
    parser.add_argument("--output-json", type=Path, required=True)
    parser.add_argument("--output-md", type=Path, required=True)
    parser.add_argument("--noteverse-head", default=None)
    parser.add_argument("--device", default=None)
    parser.add_argument("--limit-cases", type=int, default=None)
    return parser.parse_args()


def _prepare_rtt_imports(rtt_repo: Path) -> None:
    src = rtt_repo / "src"
    sys.path.insert(0, str(src.resolve()))


def _git_head(path: Path) -> str:
    return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def audit_upstream(repo: Path, checkpoint: Path, policy: dict[str, Any], *, torch: Any, torchaudio: Any) -> dict[str, Any]:
    models_text = (repo / "src" / "models.py").read_text(encoding="utf-8")
    spec_text = (repo / "src" / "spec_prep.py").read_text(encoding="utf-8")
    inference_text = (repo / "src" / "inference.py").read_text(encoding="utf-8")
    results_path = repo / "results.csv"
    return {
        "repo": "https://github.com/huispaty/rtt",
        "repoCommit": _git_head(repo),
        "checkpointSha256": sha256(checkpoint),
        "checkpointBytes": checkpoint.stat().st_size,
        "checkpointGitBlob": subprocess.check_output(["git", "-C", str(repo), "ls-tree", "HEAD", "ckpts/CustomAMT.ckpt"], text=True).strip(),
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "torchaudio": torchaudio.__version__,
        "cuda": getattr(torch.version, "cuda", None),
        "sampleRateHz": 16000,
        "nFft": 2048,
        "hopSizeSamples": 160,
        "fftDelaySamples": 160,
        "framesPerSecond": 100,
        "classes": 88,
        "pitchRange": "MIDI 21..108",
        "causalConvolutionConfirmed": "class CausalConv2d" in models_text and "causal=True" in models_text,
        "unidirectionalGruConfirmed": "bidirectional=False" in models_text,
        "rawOutputs": ["onset_output", "frame_output", "velocity_output", "offset_output"],
        "officialThresholds": {"onset": 0.5, "offset": 0.3, "frame": 0.3},
        "officialSegmentSamples": 16000 * 3,
        "officialSegmentOverlap": "pointer += segment_samples // 2" in inference_text,
        "officialInputScaling": "OFFICIAL_RUNTIME",
        "officialInputScalingReason": "inference.py loads float PCM with librosa and passes it into CustomAMT.forward(); CustomAMT.forward divides input by int16 range.",
        "inputScaleAmbiguityResolvedBy": "upstream source code path, not NoteVerse metrics",
        "resultsCsvPresent": results_path.exists(),
        "resultsCsvSha256": sha256(results_path) if results_path.exists() else None,
        "specPadLeftSamples": 2048 - 160,
        "specPadRightSamples": 160,
        "algorithmicAcousticDelayMs": 10.0,
        "specEvidence": {
            "fftDelayInSpecPrep": "fft_delay=160" in spec_text,
            "centerFalseWhenFftDelayPresent": "center=fft_delay is None" in spec_text,
        },
    }


def load_cases(paths: list[Path]) -> list[tuple[Path, dict[str, Any]]]:
    cases = []
    for path in paths:
        manifest = json.loads(path.read_text(encoding="utf-8"))
        for case in manifest.get("cases", []):
            cases.append((path, case))
    return cases


def predict_raw(model: Any, audio: np.ndarray, *, device: Any) -> tuple[dict[str, np.ndarray], dict[str, float]]:
    import torch

    started = perf_counter()
    tensor = torch.tensor(audio[None, :], device=device)
    h2d_ms = (perf_counter() - started) * 1000.0
    if str(device).startswith("cuda"):
        torch.cuda.synchronize()
    forward_started = perf_counter()
    with torch.inference_mode():
        output = {key: torch.sigmoid(value) for key, value in model(tensor).items()}
    if str(device).startswith("cuda"):
        torch.cuda.synchronize()
    forward_ms = (perf_counter() - forward_started) * 1000.0
    cpu_started = perf_counter()
    arrays = {key: value.detach().cpu().numpy()[0] for key, value in output.items()}
    cpu_ms = (perf_counter() - cpu_started) * 1000.0
    return arrays, {
        "h2dMs": round(h2d_ms, 3),
        "forwardMs": round(forward_ms, 3),
        "toCpuMs": round(cpu_ms, 3),
        "computeMs": round(h2d_ms + forward_ms + cpu_ms, 3),
    }


def onset_events(output: dict[str, np.ndarray], threshold: float) -> list[dict[str, Any]]:
    onsets = output["onset_output"]
    frames = output["frame_output"]
    velocities = output["velocity_output"]
    offsets = output["offset_output"]
    active = onsets >= threshold
    rising = np.concatenate([active[:1, :], active[1:, :] & ~active[:-1, :]], axis=0)
    events = []
    for frame_index, pitch_index in zip(*np.where(rising), strict=True):
        midi = MIDI_OFFSET + int(pitch_index)
        events.append(
            {
                "pitch": _midi_note_name(midi),
                "midiNote": midi,
                "onsetTime": round(frame_index / FRAMES_PER_SECOND, 6),
                "frameIndex": int(frame_index),
                "onsetProbability": round(float(onsets[frame_index, pitch_index]), 6),
                "frameProbability": round(float(frames[frame_index, pitch_index]), 6),
                "velocityEvidence": round(float(velocities[frame_index, pitch_index]), 6),
                "offsetEvidence": round(float(offsets[frame_index, pitch_index]), 6),
            }
        )
    return events


def evaluate_case(manifest_path: Path, case: dict[str, Any], *, model: Any, device: Any, policy: dict[str, Any], output_cache: dict[str, Any]) -> dict[str, Any]:
    audio_path = _case_audio_path(case, manifest_path=manifest_path)
    audio, sample_rate = _read_wav(audio_path)
    if sample_rate != SAMPLE_RATE:
        raise ValueError(f"expected {SAMPLE_RATE}Hz audio, got {sample_rate}")
    cache_key = str(audio_path.resolve())
    if cache_key not in output_cache:
        output_cache[cache_key] = {}
        output_cache[cache_key]["output"], output_cache[cache_key]["latency"] = predict_raw(model, audio, device=device)
    output = output_cache[cache_key]["output"]
    events = onset_events(output, float(policy["runtime"]["onsetThreshold"]))
    source_start = float((case.get("source_time_range_seconds") or [0.0])[0])
    duration = float(audio.size / sample_rate)
    gt_events = [
        {
            "pitch": str(event["pitch"]),
            "midiNote": int(event["midi_note"]),
            "onsetTime": round(float(event["start_seconds"]) - source_start, 6),
            "absoluteOnsetTime": round(float(event["start_seconds"]), 6),
            "velocity": int(event.get("velocity", 0)),
        }
        for event in case.get("ground_truth_note_events", [])
        if source_start <= float(event["start_seconds"]) < source_start + duration
    ]
    event_metrics = event_level_metrics(events, gt_events, duration)
    target_metrics = target_family_metrics(case, events, source_start, policy)
    raw_debug = target_raw_debug(case, output, source_start)
    return {
        "caseId": case.get("case_id"),
        "caseKind": case.get("case_kind"),
        "sourceAudioSha256": case.get("source_audio_sha256"),
        "sourceMidiSha256": case.get("source_midi_sha256"),
        "durationSeconds": round(duration, 6),
        "latency": output_cache[cache_key]["latency"],
        "eventCount": len(events),
        "gtOnsetCount": len(gt_events),
        "eventsPerMinute": round(len(events) / max(duration / 60.0, 1e-9), 6),
        "eventMetrics": event_metrics,
        "targetMetrics": target_metrics,
        "rawTargetEvidence": raw_debug,
        "streamSample": events[:20],
    }


def event_level_metrics(events: list[dict[str, Any]], gt_events: list[dict[str, Any]], duration: float) -> dict[str, Any]:
    by_tol = {}
    for tol_ms in [10, 20, 30, 50]:
        tol = tol_ms / 1000.0
        matched_events = set()
        matched_gt = set()
        errors = []
        candidates = []
        for gi, gt in enumerate(gt_events):
            for ei, ev in enumerate(events):
                if ei in matched_events or ev["pitch"] != gt["pitch"]:
                    continue
                delta = float(ev["onsetTime"]) - float(gt["onsetTime"])
                if abs(delta) <= tol:
                    candidates.append((abs(delta), delta, gi, ei))
        for _abs_delta, delta, gi, ei in sorted(candidates):
            if gi in matched_gt or ei in matched_events:
                continue
            matched_gt.add(gi)
            matched_events.add(ei)
            errors.append(delta * 1000.0)
        precision = len(matched_events) / len(events) if events else None
        recall = len(matched_gt) / len(gt_events) if gt_events else None
        f1 = (2 * precision * recall / (precision + recall)) if precision and recall and (precision + recall) else 0.0 if precision is not None and recall is not None else None
        by_tol[f"{tol_ms}ms"] = {
            "matched": len(matched_gt),
            "gt": len(gt_events),
            "predicted": len(events),
            "precision": round(precision, 6) if precision is not None else None,
            "recall": round(recall, 6) if recall is not None else None,
            "f1": round(f1, 6) if f1 is not None else None,
            "timingErrorMs": distribution(errors, signed=True),
        }
    duplicates = duplicate_count(events, gt_events)
    return {
        "byTolerance": by_tol,
        "unmatchedEventsPerMinuteAt50ms": round((len(events) - by_tol["50ms"]["matched"]) / max(duration / 60.0, 1e-9), 6),
        "duplicatesPerPhysicalStrikeAt50ms": round(duplicates / len(gt_events), 6) if gt_events else None,
    }


def duplicate_count(events: list[dict[str, Any]], gt_events: list[dict[str, Any]]) -> int:
    dup = 0
    for gt in gt_events:
        near = [ev for ev in events if ev["pitch"] == gt["pitch"] and abs(float(ev["onsetTime"]) - float(gt["onsetTime"])) <= 0.05]
        dup += max(0, len(near) - 1)
    return dup


def target_family_metrics(case: dict[str, Any], events: list[dict[str, Any]], source_start: float, policy: dict[str, Any]) -> dict[str, Any]:
    window = float(policy["productTargetWindowMs"]) / 1000.0
    target_abs = [float(v) for v in case.get("target_group_seconds", [])]
    target_rel = [v - source_start for v in target_abs]
    expected = [tuple(group) for group in case.get("expected_groups", [])]
    actual = [tuple(group) for group in case.get("actual_groups", [])]
    groups = []
    for i, expected_pitches in enumerate(expected):
        target = target_rel[i] if i < len(target_rel) else None
        observed = []
        evidence = {}
        for pitch in expected_pitches:
            nearest = nearest_event(events, pitch, target) if target is not None else None
            hit = nearest is not None and abs(float(nearest["onsetTime"]) - target) <= window
            evidence[pitch] = {
                "accepted": hit,
                "nearestOnsetTime": nearest["onsetTime"] if nearest else None,
                "nearestDeltaMs": round((float(nearest["onsetTime"]) - target) * 1000.0, 3) if nearest and target is not None else None,
                "onsetProbability": nearest["onsetProbability"] if nearest else None,
                "frameProbability": nearest["frameProbability"] if nearest else None,
            }
            if hit:
                observed.append(pitch)
        groups.append(
            {
                "groupIndex": i,
                "targetTime": round(target, 6) if target is not None else None,
                "expectedPitches": list(expected_pitches),
                "actualPitches": list(actual[i]) if i < len(actual) else [],
                "observedExpectedPitches": observed,
                "complete": set(observed) >= set(expected_pitches),
                "evidence": evidence,
            }
        )
    no_retrigger = no_retrigger_false_onsets(case, events, source_start)
    return {"groups": groups, "noRetrigger": no_retrigger}


def no_retrigger_false_onsets(case: dict[str, Any], events: list[dict[str, Any]], source_start: float) -> dict[str, Any] | None:
    kind = str(case.get("case_kind"))
    if kind not in {"long_held_note_without_retrigger", "pedal_sustain_tail_without_retrigger"}:
        return None
    targets = [float(v) - source_start for v in case.get("target_group_seconds", [])]
    expected_groups = [tuple(g) for g in case.get("expected_groups", [])]
    if len(targets) < 1 or len(expected_groups) < 2:
        return None
    first_time = targets[0]
    second_pitches = set(expected_groups[1])
    # A stream false retrigger is any emitted same-pitch onset after the true first onset,
    # excluding events close to a real same-pitch MIDI note-on in this clip.
    gt_same = defaultdict(list)
    for gt in case.get("ground_truth_note_events", []):
        t = float(gt["start_seconds"]) - source_start
        gt_same[str(gt["pitch"])].append(t)
    false_events = []
    for ev in events:
        if ev["pitch"] not in second_pitches or float(ev["onsetTime"]) <= first_time + 0.05:
            continue
        if any(abs(float(ev["onsetTime"]) - gt_time) <= 0.05 for gt_time in gt_same[ev["pitch"]]):
            continue
        false_events.append(ev)
    return {
        "expectedPitches": sorted(second_pitches),
        "verifiedIntervalStart": round(first_time + 0.05, 6),
        "verifiedIntervalEnd": round(float((case.get("source_time_range_seconds") or [0, 0])[1]) - source_start, 6),
        "falseOnsetCount": len(false_events),
        "falseOnsets": false_events[:20],
    }


def nearest_event(events: list[dict[str, Any]], pitch: str, target: float | None) -> dict[str, Any] | None:
    if target is None:
        return None
    pitch_events = [ev for ev in events if ev["pitch"] == pitch]
    if not pitch_events:
        return None
    return min(pitch_events, key=lambda ev: abs(float(ev["onsetTime"]) - target))


def target_raw_debug(case: dict[str, Any], output: dict[str, np.ndarray], source_start: float) -> list[dict[str, Any]]:
    rows = []
    target_abs = [float(v) for v in case.get("target_group_seconds", [])]
    for i, expected in enumerate(case.get("expected_groups", [])):
        if i >= len(target_abs):
            continue
        target = target_abs[i] - source_start
        start = max(0, int(np.floor((target - 0.05) * FRAMES_PER_SECOND)))
        end = min(output["onset_output"].shape[0], int(np.ceil((target + 0.12) * FRAMES_PER_SECOND)) + 1)
        for pitch in expected:
            idx = pitch_index(str(pitch))
            if idx < 0 or idx >= 88 or start >= end:
                continue
            onset_values = output["onset_output"][start:end, idx]
            frame_values = output["frame_output"][start:end, idx]
            rel_peak = int(np.argmax(onset_values))
            frame_index = start + rel_peak
            rows.append(
                {
                    "groupIndex": i,
                    "pitch": pitch,
                    "targetTime": round(target, 6),
                    "peakOnsetProbability": round(float(onset_values[rel_peak]), 6),
                    "peakTime": round(frame_index / FRAMES_PER_SECOND, 6),
                    "peakDeltaMs": round((frame_index / FRAMES_PER_SECOND - target) * 1000.0, 3),
                    "frameProbabilityAtPeak": round(float(frame_values[rel_peak]), 6),
                    "frameMaxNearPeak": round(float(np.max(frame_values)), 6),
                }
            )
    return rows


def pitch_index(pitch: str) -> int:
    return _pitch_to_midi_note_local(pitch) - MIDI_OFFSET


def _pitch_to_midi_note_local(pitch: str) -> int:
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    if len(pitch) == 2:
        name, octave = pitch[0], int(pitch[1])
    else:
        name, octave = pitch[:2], int(pitch[2])
    return (octave + 1) * 12 + names[name]


def prefix_invariance(cases: list[tuple[Path, dict[str, Any]]], *, model: Any, device: Any, policy: dict[str, Any]) -> dict[str, Any]:
    # Inefficient causal-prefix oracle smoke: compare settled historical frames from
    # a shorter prefix with the same frames from longer prefixes for selected clips.
    per_case = []
    max_delta = 0.0
    for manifest_path, case in cases:
        audio_path = _case_audio_path(case, manifest_path=manifest_path)
        audio, sr = _read_wav(audio_path)
        if sr != SAMPLE_RATE or audio.size < SAMPLE_RATE:
            continue
        durations = [min(audio.size, int(SAMPLE_RATE * s)) for s in (1.0, 1.5, 2.0)]
        outputs = []
        for n in durations:
            out, _latency = predict_raw(model, audio[:n], device=device)
            outputs.append(out)
        comparisons = []
        for key in ["onset_output", "frame_output", "velocity_output", "offset_output"]:
            base = outputs[0][key]
            other = outputs[-1][key]
            frames = min(base.shape[0], other.shape[0], int(0.9 * FRAMES_PER_SECOND))
            if frames <= 0:
                continue
            delta = np.abs(base[:frames] - other[:frames])
            comparisons.append({"output": key, "maxAbsDelta": round(float(np.max(delta)), 8), "meanAbsDelta": round(float(np.mean(delta)), 8), "settledFrames": frames})
            max_delta = max(max_delta, float(np.max(delta)))
        per_case.append({"caseId": case.get("case_id"), "comparisons": comparisons})
    return {
        "verdict": "PASS" if max_delta <= 1e-3 else "FAIL",
        "maxAbsDelta": round(max_delta, 8),
        "materialityThreshold": 1e-3,
        "edgeFramePolicy": "Compare frames <=900ms when extending prefixes to 2s; FFT right delay is 160 samples / 10ms.",
        "cases": per_case,
    }


def acoustic_summary(evaluations: list[dict[str, Any]], policy: dict[str, Any]) -> dict[str, Any]:
    event_precision = aggregate_event_metrics(evaluations)
    family = defaultdict(lambda: {"hit": 0, "total": 0, "false": 0, "falseTotal": 0})
    no_retrigger_false = defaultdict(int)
    no_retrigger_total = defaultdict(int)
    for ev in evaluations:
        kind = ev["caseKind"]
        groups = ev["targetMetrics"]["groups"]
        if kind == "correct_strike":
            add_positive(family["correct_single"], groups[:1])
        elif kind == "correct_chord":
            add_positive(family["complete_chord"], groups[:1])
        elif kind == "same_note_retrigger":
            if len(groups) > 1:
                add_positive(family["same_note_retrigger_second"], groups[1:2])
        elif kind == "wrong_semitone":
            add_negative(family["wrong_semitone"], groups[:1])
        elif kind == "wrong_octave":
            add_negative(family["wrong_octave"], groups[:1])
        elif kind == "missing_chord_tone":
            add_negative(family["missing_chord_tone"], groups[:1])
        elif kind == "long_held_note_without_retrigger":
            nr = ev["targetMetrics"]["noRetrigger"]
            if nr:
                no_retrigger_total["long_held_no_retrigger"] += 1
                no_retrigger_false["long_held_no_retrigger"] += int(nr["falseOnsetCount"] > 0)
        elif kind == "pedal_sustain_tail_without_retrigger":
            nr = ev["targetMetrics"]["noRetrigger"]
            if nr:
                no_retrigger_total["pedal_sustain_no_retrigger"] += 1
                no_retrigger_false["pedal_sustain_no_retrigger"] += int(nr["falseOnsetCount"] > 0)
    # The causal case manifest does not contain every Phase 6D family. Report as NOT_EVALUATED.
    required_positive = ["correct_single", "complete_chord", "same_note_retrigger_second", "dense_repeated_pitch", "fast_adjacent_pitch", "partial_overlapping_notes", "soft_attack", "loud_attack"]
    checks = {}
    hard_fail = False
    not_eval = False
    for name in required_positive:
        total = family[name]["total"]
        hit = family[name]["hit"]
        if total == 0:
            verdict = "NOT_EVALUATED"
            value = None
            not_eval = True
        else:
            value = hit / total
            verdict = "PASS" if value >= float(policy["gates"][name]["minRecall"]) else "FAIL"
            hard_fail = hard_fail or verdict == "FAIL"
        checks[name] = {"hit": hit, "sampleCount": total, "recall": round(value, 6) if value is not None else None, "verdict": verdict}
    for name in ["wrong_semitone", "wrong_octave", "missing_chord_tone"]:
        total = family[name]["falseTotal"]
        false = family[name]["false"]
        if total == 0:
            verdict = "NOT_EVALUATED"
            not_eval = True
        else:
            verdict = "PASS" if false <= int(policy["gates"][name]["maxFalseTargetAccepts"]) else "FAIL"
            hard_fail = hard_fail or verdict == "FAIL"
        checks[name] = {"falseAccepts": false, "sampleCount": total, "verdict": verdict}
    for name in ["long_held_no_retrigger", "pedal_sustain_no_retrigger"]:
        total = no_retrigger_total[name]
        false = no_retrigger_false[name]
        if total == 0:
            verdict = "NOT_EVALUATED"
            not_eval = True
        else:
            verdict = "PASS" if false <= int(policy["gates"][name]["maxFalseOnsets"]) else "FAIL"
            hard_fail = hard_fail or verdict == "FAIL"
        checks[name] = {"falseOnsetCases": false, "sampleCount": total, "verdict": verdict}
    verdict = "FAIL" if hard_fail else "INCONCLUSIVE" if not_eval else "PASS"
    return {
        "verdict": verdict,
        "eventLevel": event_precision,
        "checks": checks,
        "eventPressure": {
            "eventsPerMinute": distribution([float(e["eventsPerMinute"]) for e in evaluations]),
            "unmatchedEventsPerMinuteAt50ms": distribution([float(e["eventMetrics"]["unmatchedEventsPerMinuteAt50ms"]) for e in evaluations]),
            "duplicatesPerPhysicalStrikeAt50ms": distribution([float(e["eventMetrics"]["duplicatesPerPhysicalStrikeAt50ms"]) for e in evaluations if e["eventMetrics"]["duplicatesPerPhysicalStrikeAt50ms"] is not None]),
        },
        "latency": {
            "fullClipComputeMs": distribution([float(e["latency"]["computeMs"]) for e in evaluations]),
            "algorithmicAcousticDelayMs": 10.0,
            "note": "Full-clip compute is not strike-to-decision latency; incremental runtime was not attempted before Gate C."
        },
    }


def add_positive(bucket: dict[str, int], groups: list[dict[str, Any]]) -> None:
    for group in groups:
        bucket["total"] += 1
        bucket["hit"] += int(bool(group["complete"]))


def add_negative(bucket: dict[str, int], groups: list[dict[str, Any]]) -> None:
    for group in groups:
        bucket["falseTotal"] += 1
        bucket["false"] += int(bool(group["complete"]))


def aggregate_event_metrics(evaluations: list[dict[str, Any]]) -> dict[str, Any]:
    result = {}
    for tol in ["10ms", "20ms", "30ms", "50ms"]:
        matched = sum(e["eventMetrics"]["byTolerance"][tol]["matched"] for e in evaluations)
        gt = sum(e["eventMetrics"]["byTolerance"][tol]["gt"] for e in evaluations)
        pred = sum(e["eventMetrics"]["byTolerance"][tol]["predicted"] for e in evaluations)
        precision = matched / pred if pred else None
        recall = matched / gt if gt else None
        f1 = (2 * precision * recall / (precision + recall)) if precision and recall and precision + recall else 0.0 if precision is not None and recall is not None else None
        errors = [err for e in evaluations for err in []]
        result[tol] = {
            "matched": matched,
            "gt": gt,
            "predicted": pred,
            "precision": round(precision, 6) if precision is not None else None,
            "recall": round(recall, 6) if recall is not None else None,
            "f1": round(f1, 6) if f1 is not None else None,
        }
    return result


def distribution(values: list[float], *, signed: bool = False) -> dict[str, Any]:
    if not values:
        base = {"count": 0, "min": None, "median": None, "p95": None, "max": None, "mean": None}
    else:
        arr = np.array(values, dtype=np.float64)
        base = {
            "count": len(values),
            "min": round(float(np.min(arr)), 6),
            "median": round(float(np.median(arr)), 6),
            "p95": round(float(np.percentile(arr, 95)), 6),
            "max": round(float(np.max(arr)), 6),
            "mean": round(float(np.mean(arr)), 6),
        }
    if signed:
        base["p50"] = base["median"]
    return base


def classify_historical_reports() -> dict[str, Any]:
    return {
        "rtt_causal_frontend_audit.md": {
            "inputScaleAmbiguity": "STILL RELEVANT",
            "candidatePressure": "STILL RELEVANT",
            "directStepPitchVerifierStop": "OLD-ARCHITECTURE ONLY",
            "rttAsStrikeDetectorKeep": "SUPERSEDED BY NEW TEST"
        },
        "rtt_bytedance_candidate_handoff.md": {
            "rttToByteDanceHandoffStop": "OLD-ARCHITECTURE ONLY",
            "sameNoteSafetyFindings": "STILL RELEVANT AS DIAGNOSTIC",
            "noRetriggerSafetyFindings": "STILL RELEVANT AS DIAGNOSTIC"
        }
    }


def write_reports(args: argparse.Namespace, reports: dict[str, Any]) -> None:
    args.output_json.parent.mkdir(parents=True, exist_ok=True)
    args.output_json.write_text(json.dumps(reports, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.output_md.write_text(markdown_report(reports), encoding="utf-8")


def markdown_report(r: dict[str, Any]) -> str:
    meta = r["metadata"]
    upstream = r["upstream"]
    acoustic = r.get("developmentAcousticStream", {})
    lines = [
        "# RTT Shared Streaming Onset Frontend Decision",
        "",
        f"NoteVerse git HEAD: `{meta['noteVerseGitHead']}`",
        f"RTT upstream commit: `{meta['rttUpstreamCommit']}`",
        f"Checkpoint SHA256: `{meta['checkpoint']['sha256']}`",
        f"Checkpoint bytes: `{meta['checkpoint']['bytes']}`",
        "",
        "## Upstream Reproduction",
        "",
        f"Identity gate: `{upstream.get('identityStatus')}`",
        f"Input scaling chosen: `{upstream.get('officialInputScaling')}`",
        f"Reason: {upstream.get('officialInputScalingReason')}",
        f"Sample rate: `{upstream.get('sampleRateHz')}`; hop: `{upstream.get('hopSizeSamples')}`; n_fft: `{upstream.get('nFft')}`; fft_delay: `{upstream.get('fftDelaySamples')}`.",
        f"Causal conv confirmed: `{upstream.get('causalConvolutionConfirmed')}`; unidirectional GRU confirmed: `{upstream.get('unidirectionalGruConfirmed')}`.",
        "",
        "## Causal Prefix Invariance",
        "",
        f"Verdict: `{r.get('causalPrefixInvariance', {}).get('verdict')}`",
        f"Max absolute delta: `{r.get('causalPrefixInvariance', {}).get('maxAbsDelta')}`",
        "Algorithmic acoustic delay: `10ms` from `fft_delay=160` at 16kHz.",
        "",
        "## Development Acoustic Stream",
        "",
        f"Verdict: `{acoustic.get('verdict')}`",
        "",
        "| Criterion | Result |",
        "|---|---|",
    ]
    for name, check in acoustic.get("checks", {}).items():
        lines.append(f"| {name} | `{check}` |")
    lines.extend([
        "",
        "Event-level onset metrics:",
        "",
        "```json",
        json.dumps(acoustic.get("eventLevel"), ensure_ascii=False, indent=2),
        "```",
        "",
        "Event pressure:",
        "",
        "```json",
        json.dumps(acoustic.get("eventPressure"), ensure_ascii=False, indent=2),
        "```",
        "",
        "## Staged Stop",
        "",
        f"Development = `{r.get('development')}`",
        f"Calibration = `{r.get('calibration')}`",
        f"Browser = `{r.get('browser')}`",
        f"Stop reason: {r.get('stopReason')}",
        "",
        "## Final Verdict",
        "",
        f"```text\n{r.get('finalVerdict')}\n```",
        "",
        "Production microphone remains disabled after Phase 7.",
        "No production integration was performed.",
        "",
    ])
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
