"""Phase 7C RTT definitive streaming closure gate.

Research-only. Production practice code must not import this script.

The harness uses the pinned upstream RTT runtime to create one shared,
score-independent onset stream per Development source recording. Product
families, threshold feasibility, and diagnostics all consume that same frozen
raw stream.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import csv
import hashlib
import json
import math
from pathlib import Path
import platform
import statistics
import subprocess
import sys
import traceback
from typing import Any, Iterable
import wave

import numpy as np

from compare_step_microphone_frontends_causal_cases import _midi_note_name


FPS = 100
MIDI_OFFSET = 21
SAMPLE_RATE = 16_000
POSITIVE_GATES = {
    "correct_single",
    "complete_chord",
    "same_note_retrigger_second",
    "dense_repeated_pitch",
    "fast_adjacent_pitch",
    "partial_overlapping_notes",
    "soft_attack",
    "loud_attack",
}
FALSE_TARGET_GATES = {"wrong_semitone", "wrong_octave", "missing_chord_tone"}
NO_RETRIGGER_GATES = {"long_held_no_retrigger", "pedal_sustain_no_retrigger"}


def main() -> int:
    args = parse_args()
    policy = load_json(args.policy)
    if args.require_clean_tree and dirty_tree(args.repo_root):
        raise SystemExit("dirty tree rejected before evidence run")
    _prepare_rtt_imports(args.rtt_repo)

    import librosa
    import pretty_midi
    import torch
    import torchaudio
    from evaluate import compute_notewise_transcription_metrics, midi_to_array
    from inference import PianoTranscription

    metadata = metadata_block(args, policy, torch=torch, torchaudio=torchaudio, librosa=librosa)
    report: dict[str, Any] = {"metadata": metadata}
    report["phase7Interpretation"] = {
        "phase7": "STRONG NEGATIVE EVIDENCE",
        "phase7B": "INCONCLUSIVE",
        "phase7C": "final RTT model-quality closure",
    }
    identity = upstream_identity_audit(args, policy, torch=torch, torchaudio=torchaudio)
    report["upstreamIdentityAudit"] = identity
    if identity["verdict"] != "PASS":
        return write_decision(args, report, "INCONCLUSIVE", "upstream identity audit failed")

    targets_report = load_json(args.development_targets)
    targets = list(targets_report["targets"])
    source_index = build_source_index(args, policy, targets)
    report["sourceAssetVerification"] = source_asset_report(source_index)

    try:
        transcriptor = PianoTranscription(
            checkpoint_path=str(args.checkpoint),
            onset_threshold=float(policy["runtime"]["officialOnsetThreshold"]),
            offset_threshold=float(policy["runtime"]["officialOffsetThreshold"]),
            frame_threshold=float(policy["runtime"]["officialFrameThreshold"]),
            overlap=True,
            postprocessor="rtt",
            segment_samples=int(policy["runtime"]["officialSegmentSamples"]),
            device=torch.device(args.device or ("cuda" if torch.cuda.is_available() else "cpu")),
        )
    except Exception as exc:  # pragma: no cover - exercised in research envs
        report["upstreamMetricReproduction"] = {
            "verdict": "INCONCLUSIVE",
            "reason": "Official upstream transcriptor could not be constructed.",
            "exception": repr(exc),
            "traceback": traceback.format_exc(limit=8),
        }
        return write_decision(args, report, "INCONCLUSIVE", "official upstream runtime unavailable")

    streams = build_source_streams(
        args,
        policy,
        targets=targets,
        sources=source_index,
        transcriptor=transcriptor,
        librosa=librosa,
        pretty_midi=pretty_midi,
    )
    upstream = reproduce_upstream_metrics(
        args,
        policy,
        streams=streams,
        compute_notewise_transcription_metrics=compute_notewise_transcription_metrics,
        midi_to_array=midi_to_array,
    )
    write_json(args.upstream_output, upstream)
    report["upstreamMetricReproduction"] = {"path": str(args.upstream_output), "sha256": sha256(args.upstream_output), "summary": summarize_upstream(upstream)}
    if upstream["verdict"] != "PASS":
        return write_decision(args, report, "INCONCLUSIVE", "upstream metric reproduction did not pass")

    development = evaluate_development(policy, targets=targets, streams=streams)
    write_json(args.development_output, development)
    threshold_summary = summarize_threshold_feasibility(development, policy)
    write_json(args.threshold_output, threshold_summary)
    report["developmentEvidence"] = {"path": str(args.development_output), "sha256": sha256(args.development_output), "summary": compact_development_summary(development)}
    report["thresholdFeasibility"] = {"path": str(args.threshold_output), "sha256": sha256(args.threshold_output), "summary": threshold_summary}

    if threshold_summary["development"] == "PASS":
        return write_decision(args, report, "INCONCLUSIVE", "Development passed; Calibration remains required but is outside this run")
    if threshold_summary["development"] == "FAIL":
        return write_decision(args, report, "FAIL", "every frozen threshold has at least one valid hard failure")
    return write_decision(args, report, "INCONCLUSIVE", "no threshold passed and at least one threshold remained not fully evaluated")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--repo-root", type=Path, default=Path("."))
    p.add_argument("--policy", type=Path, required=True)
    p.add_argument("--rtt-repo", type=Path, required=True)
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--maestro-root", type=Path, required=True)
    p.add_argument("--development-targets", type=Path, required=True)
    p.add_argument("--upstream-output", type=Path, required=True)
    p.add_argument("--development-output", type=Path, required=True)
    p.add_argument("--threshold-output", type=Path, required=True)
    p.add_argument("--decision-json", type=Path, required=True)
    p.add_argument("--decision-md", type=Path, required=True)
    p.add_argument("--device", default=None)
    p.add_argument("--research-harness-git-head", required=True)
    p.add_argument("--require-clean-tree", action="store_true")
    return p.parse_args()


def metadata_block(args: argparse.Namespace, policy: dict[str, Any], *, torch: Any, torchaudio: Any, librosa: Any) -> dict[str, Any]:
    return {
        "generatedAt": "2026-10-05T00:00:00+08:00",
        "researchHarnessGitHead": args.research_harness_git_head,
        "harnessSha256": sha256(Path(__file__)),
        "policy": {"path": str(args.policy), "sha256": sha256(args.policy)},
        "exactCommand": " ".join(sys.argv),
        "dirtyTree": dirty_tree(args.repo_root),
        "os": platform.platform(),
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "torchaudio": torchaudio.__version__,
        "librosa": librosa.__version__,
        "numpy": np.__version__,
        "cuda": getattr(torch.version, "cuda", None),
        "cudaAvailable": bool(torch.cuda.is_available()),
        "device": args.device or ("cuda" if torch.cuda.is_available() else "cpu"),
        "rttUpstreamCommit": git_head(args.rtt_repo),
        "checkpointSha256": sha256(args.checkpoint),
        "checkpointBytes": args.checkpoint.stat().st_size,
        "upstreamResultsCsvSha256": sha256(args.rtt_repo / "results.csv"),
        "developmentManifestSha256": sha256(args.development_targets),
        "frozenEvaluationUsed": False,
    }


def upstream_identity_audit(args: argparse.Namespace, policy: dict[str, Any], *, torch: Any, torchaudio: Any) -> dict[str, Any]:
    failures: list[str] = []
    if git_head(args.rtt_repo) != policy["candidate"]["commit"]:
        failures.append("RTT commit mismatch")
    if sha256(args.checkpoint) != policy["candidate"]["expectedCheckpointSha256"]:
        failures.append("checkpoint SHA mismatch")
    if args.checkpoint.stat().st_size != int(policy["candidate"]["expectedCheckpointBytes"]):
        failures.append("checkpoint byte size mismatch")
    if sha256(args.rtt_repo / "results.csv") != policy["candidate"]["expectedResultsCsvSha256"]:
        failures.append("results.csv SHA mismatch")
    return {
        "verdict": "FAIL" if failures else "PASS",
        "failures": failures,
        "repo": policy["candidate"]["repo"],
        "commit": git_head(args.rtt_repo),
        "checkpointSha256": sha256(args.checkpoint),
        "checkpointBytes": args.checkpoint.stat().st_size,
        "resultsCsvSha256": sha256(args.rtt_repo / "results.csv"),
        "torch": torch.__version__,
        "torchaudio": torchaudio.__version__,
        "officialRuntime": {
            "segmentSamples": 48000,
            "overlap": "50%",
            "postProcessor": "RTTPostProcessor",
            "onsetThreshold": 0.5,
            "offsetThreshold": 0.3,
            "frameThreshold": 0.3,
        },
    }


def build_source_index(args: argparse.Namespace, policy: dict[str, Any], targets: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    frozen = set(policy["upstreamMetricReproduction"]["frozenBasenames"])
    by_base: dict[str, dict[str, Any]] = {}
    for target in targets:
        audio = resolve_dataset_path(args, target["sourceFile"])
        midi = resolve_dataset_path(args, target["sourceMidi"])
        base = audio.stem
        if base not in frozen:
            continue
        by_base.setdefault(base, {
            "basename": base,
            "audioPath": audio,
            "midiPath": midi,
            "expectedAudioSha256": target["sourceAudioSha256"],
            "expectedMidiSha256": target["sourceMidiSha256"],
            "targets": [],
        })["targets"].append(target)
    missing = sorted(frozen - set(by_base))
    if missing:
        raise ValueError(f"Frozen Development basenames missing from target manifest: {missing}")
    return {base: by_base[base] for base in policy["upstreamMetricReproduction"]["frozenBasenames"]}


def resolve_dataset_path(args: argparse.Namespace, manifest_path: str) -> Path:
    repo_path = args.repo_root / "backend" / manifest_path
    if repo_path.exists():
        return repo_path
    marker = "maestro-v3.0.0/"
    normalized = manifest_path.replace("\\", "/")
    if marker in normalized:
        candidate = args.maestro_root / normalized.split(marker, 1)[1]
        if candidate.exists():
            return candidate
    return repo_path


def source_asset_report(sources: dict[str, dict[str, Any]]) -> list[dict[str, Any]]:
    report = []
    for source in sources.values():
        audio = Path(source["audioPath"])
        midi = Path(source["midiPath"])
        with wave.open(str(audio), "rb") as wav:
            sample_rate = wav.getframerate()
            channels = wav.getnchannels()
            sample_width = wav.getsampwidth()
            frames = wav.getnframes()
        audio_sha = sha256(audio)
        midi_sha = sha256(midi)
        report.append({
            "basename": source["basename"],
            "audioPath": str(audio),
            "audioBytes": audio.stat().st_size,
            "audioSha256": audio_sha,
            "expectedAudioSha256": source["expectedAudioSha256"],
            "audioHashVerified": audio_sha == source["expectedAudioSha256"],
            "sampleRate": sample_rate,
            "channels": channels,
            "sampleWidthBytes": sample_width,
            "durationSeconds": round(frames / sample_rate, 6),
            "nativeAssetAssessment": "MAESTRO_WAV_44K_STEREO" if sample_rate == 44100 and channels == 2 else "NON_NATIVE_OR_DERIVED_REVIEW_REQUIRED",
            "midiPath": str(midi),
            "midiSha256": midi_sha,
            "expectedMidiSha256": source["expectedMidiSha256"],
            "midiHashVerified": midi_sha == source["expectedMidiSha256"],
        })
        if audio_sha != source["expectedAudioSha256"] or midi_sha != source["expectedMidiSha256"]:
            raise ValueError(f"source hash mismatch: {source['basename']}")
    return report


def build_source_streams(args: argparse.Namespace, policy: dict[str, Any], *, targets: list[dict[str, Any]], sources: dict[str, dict[str, Any]], transcriptor: Any, librosa: Any, pretty_midi: Any) -> dict[str, Any]:
    streams: dict[str, Any] = {}
    for base, source in sources.items():
        audio, _ = librosa.load(str(source["audioPath"]), sr=SAMPLE_RATE, mono=True)
        transcribed = transcriptor.transcribe(audio)
        midi = pretty_midi.PrettyMIDI(str(source["midiPath"]))
        notes = midi_notes(midi)
        raw = {key: value for key, value in transcribed["output_dict"].items()}
        duration = len(audio) / SAMPLE_RATE
        streams[base] = {
            "basename": base,
            "audioDurationSeconds": duration,
            "raw": raw,
            "officialEvents": transcribed["est_note_events"],
            "midiNotes": notes,
            "targetIds": [target["targetId"] for target in source["targets"]],
            "sourceFile": str(source["audioPath"]),
            "sourceMidi": str(source["midiPath"]),
            "geometry": {
                "mode": "FULL_SOURCE",
                "startupCold": "[0,10) seconds uses model initial state and real source audio from t=0.",
                "steadyState": "Targets at t>=10s have at least 10s real musical history in the full-source stream.",
                "ownership": "Each source timestamp is decoded once from the source-level stream.",
            },
        }
    return streams


def reproduce_upstream_metrics(args: argparse.Namespace, policy: dict[str, Any], *, streams: dict[str, Any], compute_notewise_transcription_metrics: Any, midi_to_array: Any) -> dict[str, Any]:
    rows = {row["file"]: row for row in csv.DictReader((args.rtt_repo / "results.csv").open("r", encoding="utf-8"))}
    tolerances = [float(v) for v in policy["upstreamMetricReproduction"]["tolerancesSeconds"]]
    metric_names = list(policy["upstreamMetricReproduction"]["compareMetrics"])
    per_file_tol = float(policy["upstreamMetricReproduction"]["perFileF1Tolerance"])
    aggregate_tol = float(policy["upstreamMetricReproduction"]["aggregateMeanF1Tolerance"])
    selected = []
    deltas_by_key: dict[str, list[float]] = defaultdict(list)
    for base, stream in streams.items():
        if base not in rows:
            return {"verdict": "INCONCLUSIVE", "reason": f"Frozen source not present in upstream results.csv: {base}"}
        expected = rows[base]
        reference = midi_to_array(stream["sourceMidi"])
        computed: dict[str, float] = {}
        expected_metrics: dict[str, float] = {}
        deltas: dict[str, float] = {}
        for tolerance in tolerances:
            metrics = compute_notewise_transcription_metrics(reference, stream["officialEvents"], onset_tolerance=tolerance)
            for metric_name in metric_names:
                key = f"{metric_name}-{tolerance}"
                expected_metrics[key] = float(expected[key])
                computed[key] = float(metrics[metric_name])
                deltas[key] = abs(computed[key] - expected_metrics[key])
                deltas_by_key[key].append(deltas[key])
        selected.append({
            "file": base,
            "expected": expected_metrics,
            "computed": computed,
            "absoluteDelta": deltas,
            "perFileF1Pass": all(deltas[f"note-on-f-{t}"] <= per_file_tol for t in tolerances),
        })
    aggregate = {}
    aggregate_pass = True
    for key, values in sorted(deltas_by_key.items()):
        mean_delta = float(np.mean(values))
        aggregate[key] = {"meanAbsoluteDelta": round(mean_delta, 8), "maxAbsoluteDelta": round(float(np.max(values)), 8)}
        if key.startswith("note-on-f-"):
            aggregate_pass = aggregate_pass and mean_delta <= aggregate_tol
    per_file_pass = all(item["perFileF1Pass"] for item in selected)
    return {
        "artifact": "rtt_upstream_reproduction_v3",
        "verdict": "PASS" if per_file_pass and aggregate_pass else "INCONCLUSIVE",
        "cohort": [item["file"] for item in selected],
        "perFileF1Tolerance": per_file_tol,
        "aggregateMeanF1Tolerance": aggregate_tol,
        "selectedRows": selected,
        "aggregate": aggregate,
        "reason": "Official metric reproduction passed." if per_file_pass and aggregate_pass else "Official metric reproduction did not match pinned results.csv within frozen tolerance.",
    }


def evaluate_development(policy: dict[str, Any], *, targets: list[dict[str, Any]], streams: dict[str, Any]) -> dict[str, Any]:
    thresholds = [float(v) for v in policy["runtime"]["thresholdSweep"]]
    source_notes = {base: stream["midiNotes"] for base, stream in streams.items()}
    no_retrigger_episodes = build_no_retrigger_episodes(targets, source_notes)
    threshold_results = {}
    for threshold in thresholds:
        events_by_source = {base: events_from_raw(stream["raw"], threshold) for base, stream in streams.items()}
        threshold_results[str(threshold)] = score_threshold(policy, targets, events_by_source, source_notes, no_retrigger_episodes)
    return {
        "artifact": "rtt_streaming_development_v3",
        "sourceCount": len(streams),
        "targetCount": len(targets),
        "streamGeometry": {base: stream["geometry"] for base, stream in streams.items()},
        "familyCounts": dict(sorted(count_by(targets, "metricFamily").items())),
        "summary": {"thresholds": threshold_results},
    }


def score_threshold(policy: dict[str, Any], targets: list[dict[str, Any]], events_by_source: dict[str, list[dict[str, Any]]], source_notes: dict[str, list[dict[str, Any]]], no_retrigger_episodes: list[dict[str, Any]]) -> dict[str, Any]:
    target_window = float(policy["streamGeometry"]["targetWindowMs"]) / 1000
    families = defaultdict(lambda: {"hit": 0, "total": 0, "false": 0, "falseTotal": 0})
    raw_peaks = {"positive": [], "wrongExpectedPitch": [], "noRetriggerNegative": []}
    for target in targets:
        metric = target["metricFamily"]
        if metric not in POSITIVE_GATES and metric not in FALSE_TARGET_GATES:
            continue
        base = Path(target["sourceFile"]).stem
        events = events_by_source.get(base, [])
        target_time = float(target.get("physicalAttackTime") or target.get("scheduledExpectedTime") or target.get("candidateTime") or 0)
        if target["shouldMatch"] and metric in POSITIVE_GATES:
            complete = all(has_event(events, pitch, target_time, target_window) for pitch in target["expectedPitches"])
            families[metric]["hit"] += int(complete)
            families[metric]["total"] += 1
            raw_peaks["positive"].extend(peak_for_pitch(events, pitch, target_time, target_window) for pitch in target["expectedPitches"])
        elif metric in FALSE_TARGET_GATES:
            false_accept = all(has_event(events, pitch, target_time, target_window) for pitch in target["expectedPitches"])
            families[metric]["false"] += int(false_accept)
            families[metric]["falseTotal"] += 1
            raw_peaks["wrongExpectedPitch"].extend(peak_for_pitch(events, pitch, target_time, target_window) for pitch in target["expectedPitches"])

    false_retrigger = score_no_retrigger_episodes(no_retrigger_episodes, events_by_source, source_notes, target_window)
    for item in false_retrigger["negativePeaks"]:
        raw_peaks["noRetriggerNegative"].append(item)

    checks = {}
    for name, gate in policy["gates"].items():
        if "minRecall" in gate:
            total = families[name]["total"]
            hit = families[name]["hit"]
            if total == 0:
                checks[name] = {"verdict": "NOT_EVALUATED", "sampleCount": 0, "hit": hit, "recall": None}
            else:
                recall = hit / total
                checks[name] = {"verdict": "PASS" if recall >= float(gate["minRecall"]) else "FAIL", "sampleCount": total, "hit": hit, "recall": round(recall, 6), "required": gate["minRecall"]}
        elif "maxFalseTargetAccepts" in gate:
            total = families[name]["falseTotal"]
            false = families[name]["false"]
            if total == 0:
                checks[name] = {"verdict": "NOT_EVALUATED", "sampleCount": 0, "falseAccepts": false}
            else:
                checks[name] = {"verdict": "PASS" if false <= int(gate["maxFalseTargetAccepts"]) else "FAIL", "sampleCount": total, "falseAccepts": false, "maxAllowed": gate["maxFalseTargetAccepts"]}
        else:
            events = false_retrigger["byFamily"].get(name, [])
            sample_count = false_retrigger["episodeCounts"].get(name, 0)
            if sample_count == 0:
                checks[name] = {"verdict": "NOT_EVALUATED", "sampleCount": 0, "falseRetriggerEvents": 0}
            else:
                checks[name] = {"verdict": "PASS" if len(events) <= int(gate["maxFalseRetriggerEvents"]) else "FAIL", "sampleCount": sample_count, "falseRetriggerEvents": len(events), "events": events[:20]}

    acoustic_metrics = source_level_metrics(events_by_source, source_notes, policy)
    pressure = event_pressure(events_by_source, source_notes)
    return {
        "verdict": threshold_verdict(checks),
        "checks": checks,
        "sourceLevelEventMetrics": acoustic_metrics,
        "eventPressure": pressure,
        "rawActivationDistributions": summarize_raw_peaks(raw_peaks),
    }


def threshold_verdict(checks: dict[str, dict[str, Any]]) -> str:
    if any(check["verdict"] == "FAIL" for check in checks.values()):
        return "FAIL"
    if any(check["verdict"] == "NOT_EVALUATED" for check in checks.values()):
        return "INCONCLUSIVE"
    return "PASS"


def summarize_threshold_feasibility(dev: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    thresholds = dev["summary"]["thresholds"]
    eligible = []
    for threshold, result in thresholds.items():
        if result["verdict"] == "PASS":
            margin = minimum_positive_margin(result["checks"])
            eligible.append({"threshold": float(threshold), "minimumPositiveMargin": margin})
    if eligible:
        selected = sorted(eligible, key=lambda x: (-x["minimumPositiveMargin"], abs(x["threshold"] - 0.5), -x["threshold"]))[0]
        return {"development": "PASS", "eligibleThresholds": eligible, "selectedThreshold": selected["threshold"], "reason": "At least one threshold passed every hard gate."}
    all_have_fail = all(any(check["verdict"] == "FAIL" for check in result["checks"].values()) for result in thresholds.values())
    return {
        "development": "FAIL" if all_have_fail else "INCONCLUSIVE",
        "eligibleThresholds": [],
        "selectedThreshold": None,
        "reason": "Every threshold has at least one valid hard failure." if all_have_fail else "No threshold passed; at least one threshold had no hard failure but missing required evidence.",
    }


def minimum_positive_margin(checks: dict[str, dict[str, Any]]) -> float:
    margins = []
    for name in POSITIVE_GATES:
        check = checks[name]
        if check["recall"] is None:
            return float("-inf")
        margins.append(float(check["recall"]) - float(check["required"]))
    return round(min(margins), 6)


def midi_notes(midi: Any) -> list[dict[str, Any]]:
    notes = []
    for inst in midi.instruments:
        for note in inst.notes:
            notes.append({"start": float(note.start), "end": float(note.end), "midi": int(note.pitch), "pitch": _midi_note_name(int(note.pitch)), "velocity": int(note.velocity)})
    return sorted(notes, key=lambda n: (n["start"], n["midi"]))


def build_no_retrigger_episodes(targets: list[dict[str, Any]], source_notes: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    grouped: dict[tuple[str, str, str, float], dict[str, Any]] = {}
    for target in targets:
        family = target["metricFamily"]
        if family not in NO_RETRIGGER_GATES:
            continue
        base = Path(target["sourceFile"]).stem
        pitch = target["expectedPitches"][0]
        previous = nearest_previous_same_pitch(source_notes[base], pitch, float(target.get("stressProbeTime") or target.get("candidateTime") or 0))
        if previous is None:
            continue
        next_note = nearest_next_same_pitch(source_notes[base], pitch, previous["start"] + 1e-6)
        probe = float(target.get("stressProbeTime") or target.get("candidateTime") or previous["start"])
        key = (base, family, pitch, round(previous["start"], 6))
        item = grouped.setdefault(key, {
            "episodeId": f"{base}:{family}:{pitch}:{previous['start']:.6f}",
            "source": base,
            "family": family,
            "pitch": pitch,
            "previousAttack": previous["start"],
            "nextAttack": next_note["start"] if next_note else None,
            "intervalStart": previous["start"] + 0.05,
            "intervalEnd": next_note["start"] if next_note else probe,
            "probeTimes": [],
        })
        item["intervalEnd"] = min(item["nextAttack"], max(item["intervalEnd"], probe)) if item["nextAttack"] is not None else max(item["intervalEnd"], probe)
        item["probeTimes"].append(probe)
    return list(grouped.values())


def score_no_retrigger_episodes(episodes: list[dict[str, Any]], events_by_source: dict[str, list[dict[str, Any]]], source_notes: dict[str, list[dict[str, Any]]], match_window: float) -> dict[str, Any]:
    by_family: dict[str, list[dict[str, Any]]] = defaultdict(list)
    counts: dict[str, int] = defaultdict(int)
    negative_peaks = []
    for ep in episodes:
        counts[ep["family"]] += 1
        for ev in events_by_source.get(ep["source"], []):
            if ev["pitch"] != ep["pitch"]:
                continue
            t = float(ev["absoluteOnsetTime"])
            if not (ep["intervalStart"] <= t < ep["intervalEnd"]):
                continue
            if matches_real_midi(source_notes[ep["source"]], ep["pitch"], t, match_window):
                continue
            record = {
                "episodeId": ep["episodeId"],
                "pitch": ep["pitch"],
                "absoluteOnsetTime": t,
                "onsetProbability": ev["onsetProbability"],
                "previousGtSamePitchAttack": ep["previousAttack"],
                "nextGtSamePitchAttack": ep["nextAttack"],
                "distanceFromPrevious": round(t - ep["previousAttack"], 6),
                "distanceFromNext": round(ep["nextAttack"] - t, 6) if ep["nextAttack"] is not None else None,
            }
            by_family[ep["family"]].append(record)
            negative_peaks.append(ev["onsetProbability"])
    return {"byFamily": by_family, "episodeCounts": counts, "negativePeaks": negative_peaks}


def events_from_raw(raw: dict[str, np.ndarray], threshold: float) -> list[dict[str, Any]]:
    onset = raw["onset_output"]
    frame = raw["frame_output"]
    velocity = raw.get("velocity_output", np.zeros_like(onset))
    offset = raw.get("offset_output", np.zeros_like(onset))
    active = onset >= threshold
    rising = np.concatenate([active[:1, :], active[1:, :] & ~active[:-1, :]], axis=0)
    events = []
    for frame_index, pitch_index in zip(*np.where(rising), strict=True):
        events.append({
            "pitch": _midi_note_name(MIDI_OFFSET + int(pitch_index)),
            "midi": MIDI_OFFSET + int(pitch_index),
            "absoluteOnsetTime": round(frame_index / FPS, 6),
            "onsetProbability": round(float(onset[frame_index, pitch_index]), 6),
            "frameProbability": round(float(frame[frame_index, pitch_index]), 6),
            "velocityEvidence": round(float(velocity[frame_index, pitch_index]), 6),
            "offsetEvidence": round(float(offset[frame_index, pitch_index]), 6),
        })
    return events


def source_level_metrics(events_by_source: dict[str, list[dict[str, Any]]], source_notes: dict[str, list[dict[str, Any]]], policy: dict[str, Any]) -> dict[str, Any]:
    result = {}
    for tol_ms in policy["diagnosticTolerancesMs"]:
        tol = float(tol_ms) / 1000
        all_errors = []
        total_pred = total_gt = total_match = 0
        for base, events in events_by_source.items():
            matches = one_to_one_match(events, source_notes[base], tol)
            total_match += len(matches)
            total_pred += len(events)
            total_gt += len(source_notes[base])
            all_errors.extend(match["error"] for match in matches)
        precision = total_match / total_pred if total_pred else 0
        recall = total_match / total_gt if total_gt else 0
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
        result[str(tol_ms)] = {
            "precision": round(precision, 6),
            "recall": round(recall, 6),
            "f1": round(f1, 6),
            "matched": total_match,
            "predicted": total_pred,
            "groundTruth": total_gt,
            "timing": timing_distribution(all_errors),
        }
    return result


def one_to_one_match(events: list[dict[str, Any]], notes: list[dict[str, Any]], tolerance: float) -> list[dict[str, float]]:
    edges = []
    for ei, event in enumerate(events):
        for ni, note in enumerate(notes):
            if event["pitch"] != note["pitch"]:
                continue
            error = float(event["absoluteOnsetTime"]) - float(note["start"])
            if abs(error) <= tolerance:
                edges.append((abs(error), error, ei, ni))
    edges.sort()
    used_events: set[int] = set()
    used_notes: set[int] = set()
    matches = []
    for _, error, ei, ni in edges:
        if ei in used_events or ni in used_notes:
            continue
        used_events.add(ei); used_notes.add(ni)
        matches.append({"error": error})
    return matches


def timing_distribution(errors: list[float]) -> dict[str, Any]:
    if not errors:
        return {"sampleCount": 0}
    arr = np.array(errors) * 1000
    abs_arr = np.abs(arr)
    return {
        "sampleCount": len(errors),
        "signedP05Ms": round(float(np.percentile(arr, 5)), 3),
        "signedMedianMs": round(float(np.percentile(arr, 50)), 3),
        "signedP95Ms": round(float(np.percentile(arr, 95)), 3),
        "absoluteMedianMs": round(float(np.percentile(abs_arr, 50)), 3),
        "absoluteP95Ms": round(float(np.percentile(abs_arr, 95)), 3),
        "absoluteMaxMs": round(float(np.max(abs_arr)), 3),
    }


def event_pressure(events_by_source: dict[str, list[dict[str, Any]]], source_notes: dict[str, list[dict[str, Any]]]) -> dict[str, Any]:
    duration = sum(max((n["end"] for n in notes), default=0) for notes in source_notes.values())
    event_count = sum(len(events) for events in events_by_source.values())
    physical = sum(len(notes) for notes in source_notes.values())
    return {
        "eventsPerMinute": round(event_count / (duration / 60), 3) if duration else None,
        "duplicatesPerPhysicalOnset": round(max(0, event_count - physical) / physical, 6) if physical else None,
    }


def summarize_raw_peaks(raw_peaks: dict[str, list[float]]) -> dict[str, Any]:
    return {name: distribution(values) for name, values in raw_peaks.items()}


def distribution(values: Iterable[float]) -> dict[str, Any]:
    vals = [float(v) for v in values if v is not None]
    if not vals:
        return {"sampleCount": 0}
    arr = np.array(vals)
    return {
        "sampleCount": len(vals),
        "min": round(float(np.min(arr)), 6),
        "p05": round(float(np.percentile(arr, 5)), 6),
        "p50": round(float(np.percentile(arr, 50)), 6),
        "p95": round(float(np.percentile(arr, 95)), 6),
        "max": round(float(np.max(arr)), 6),
    }


def has_event(events: list[dict[str, Any]], pitch: str, target_time: float, window: float) -> bool:
    return any(event["pitch"] == pitch and abs(float(event["absoluteOnsetTime"]) - target_time) <= window for event in events)


def peak_for_pitch(events: list[dict[str, Any]], pitch: str, target_time: float, window: float) -> float | None:
    vals = [float(event["onsetProbability"]) for event in events if event["pitch"] == pitch and abs(float(event["absoluteOnsetTime"]) - target_time) <= window]
    return max(vals) if vals else 0.0


def nearest_previous_same_pitch(notes: list[dict[str, Any]], pitch: str, time: float) -> dict[str, Any] | None:
    candidates = [note for note in notes if note["pitch"] == pitch and note["start"] <= time]
    return max(candidates, key=lambda n: n["start"]) if candidates else None


def nearest_next_same_pitch(notes: list[dict[str, Any]], pitch: str, time: float) -> dict[str, Any] | None:
    candidates = [note for note in notes if note["pitch"] == pitch and note["start"] > time]
    return min(candidates, key=lambda n: n["start"]) if candidates else None


def matches_real_midi(notes: list[dict[str, Any]], pitch: str, time: float, window: float) -> bool:
    return any(note["pitch"] == pitch and abs(note["start"] - time) <= window for note in notes)


def summarize_upstream(upstream: dict[str, Any]) -> dict[str, Any]:
    return {"verdict": upstream["verdict"], "cohort": upstream.get("cohort", []), "aggregate": upstream.get("aggregate"), "reason": upstream.get("reason")}


def compact_development_summary(dev: dict[str, Any]) -> dict[str, Any]:
    return {"sourceCount": dev["sourceCount"], "targetCount": dev["targetCount"], "thresholdVerdicts": {k: v["verdict"] for k, v in dev["summary"]["thresholds"].items()}}


def write_decision(args: argparse.Namespace, report: dict[str, Any], verdict: str, reason: str) -> int:
    final = {
        "development": report.get("thresholdFeasibility", {}).get("summary", {}).get("development", "NOT RUN" if verdict == "INCONCLUSIVE" else verdict),
        "calibration": "NOT RUN",
        "stepReplay": "NOT RUN",
        "continuousReplay": "NOT RUN",
        "browser": "NOT RUN",
        "verdict": f"RTT Shared Streaming Onset Frontend = {verdict}",
        "reason": reason,
        "productionMicrophone": "DISABLED",
    }
    report["final"] = final
    write_json(args.decision_json, report)
    args.decision_md.write_text(markdown(report), encoding="utf-8")
    return 1 if verdict == "FAIL" else 0


def markdown(report: dict[str, Any]) -> str:
    lines = [
        "# RTT Streaming-State Closure Decision v3",
        "",
        f"Research harness SHA: `{report['metadata']['researchHarnessGitHead']}`",
        f"Checkpoint SHA256: `{report['metadata']['checkpointSha256']}`",
        "",
        "## Historical Disposition",
        "",
        "Phase 7: `STRONG NEGATIVE EVIDENCE`",
        "Phase 7B: `INCONCLUSIVE`",
        "",
        "## Upstream",
        "",
        f"identity audit: `{report.get('upstreamIdentityAudit', {}).get('verdict')}`",
        f"metric reproduction: `{report.get('upstreamMetricReproduction', {}).get('summary', {}).get('verdict', report.get('upstreamMetricReproduction', {}).get('verdict'))}`",
        "",
        "## Development",
        "",
        f"threshold feasibility: `{report.get('thresholdFeasibility', {}).get('summary', {}).get('development', 'NOT RUN')}`",
        f"reason: {report['final']['reason']}",
        "",
        f"```text\n{report['final']['verdict']}\n```",
        "",
        "Production microphone remains disabled after Phase 7C.",
        "No production integration was performed.",
        "",
    ]
    return "\n".join(lines)


def count_by(items: list[dict[str, Any]], key: str) -> dict[str, int]:
    counts: dict[str, int] = defaultdict(int)
    for item in items:
        counts[item[key]] += 1
    return counts


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def _prepare_rtt_imports(rtt_repo: Path) -> None:
    sys.path.insert(0, str((rtt_repo / "src").resolve()))


def git_head(path: Path) -> str:
    return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()


def dirty_tree(path: Path) -> bool:
    return bool(subprocess.check_output(["git", "-C", str(path), "status", "--porcelain"], text=True).strip())


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
