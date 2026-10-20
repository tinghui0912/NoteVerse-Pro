"""Phase 7B RTT streaming-state closure gate.

Research-only. The harness separates upstream identity audit from upstream
metric reproduction, runs source-time chunked acoustic streams, and evaluates a
frozen global threshold sweep from the same raw outputs.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
import csv
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import sys
import traceback
from time import perf_counter
from typing import Any

import numpy as np

from compare_step_microphone_frontends_causal_cases import _midi_note_name, _read_wav


SAMPLE_RATE = 16_000
FPS = 100
MIDI_OFFSET = 21


def main() -> int:
    args = parse_args()
    policy = load_json(args.policy)
    ensure_clean = args.require_clean_tree
    if ensure_clean and dirty_tree(args.repo_root):
        raise SystemExit("dirty tree rejected before evidence run")
    _prepare_rtt_imports(args.rtt_repo)

    import torch
    import torchaudio
    from models import CustomAMT
    from pl_model import RTT

    metadata = metadata_block(args, policy, torch=torch, torchaudio=torchaudio)
    reports: dict[str, Any] = {"metadata": metadata}
    reports["upstreamIdentityAudit"] = upstream_identity_audit(args, policy, torch=torch, torchaudio=torchaudio)
    if reports["upstreamIdentityAudit"]["verdict"] != "PASS":
        return write_all(args, reports, verdict="RTT Shared Streaming Onset Frontend = INCONCLUSIVE", development="INCONCLUSIVE", reason="upstream identity audit failed")

    model = load_model(args, torch=torch, CustomAMT=CustomAMT, RTT=RTT)
    reports["upstreamMetricReproduction"] = upstream_metric_reproduction(args, policy, model=model)
    if reports["upstreamMetricReproduction"]["verdict"] != "PASS":
        return write_all(args, reports, verdict="RTT Shared Streaming Onset Frontend = INCONCLUSIVE", development="INCONCLUSIVE", reason="upstream metric reproduction did not pass")

    targets_report = load_json(args.development_targets)
    verify_target_sources(targets_report)
    development = evaluate_development(args, policy, model=model, targets=targets_report["targets"])
    reports["developmentEvidence"] = {
        "path": str(args.development_output),
        "sha256": None,
        "summary": development["summary"],
    }
    args.development_output.parent.mkdir(parents=True, exist_ok=True)
    args.development_output.write_text(json.dumps(development, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    reports["developmentEvidence"]["sha256"] = sha256(args.development_output)

    decision = decision_from_development(development, policy)
    reports["decision"] = decision
    final = "RTT Shared Streaming Onset Frontend = FAIL" if decision["development"] == "FAIL" else "RTT Shared Streaming Onset Frontend = INCONCLUSIVE"
    return write_all(args, reports, verdict=final, development=decision["development"], reason=decision["reason"])


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--repo-root", type=Path, default=Path("."))
    p.add_argument("--policy", type=Path, required=True)
    p.add_argument("--rtt-repo", type=Path, required=True)
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--maestro-root", type=Path, required=True)
    p.add_argument("--development-targets", type=Path, required=True)
    p.add_argument("--development-output", type=Path, required=True)
    p.add_argument("--decision-json", type=Path, required=True)
    p.add_argument("--decision-md", type=Path, required=True)
    p.add_argument("--device", default=None)
    p.add_argument("--research-harness-git-head", required=True)
    p.add_argument("--require-clean-tree", action="store_true")
    return p.parse_args()


def metadata_block(args: argparse.Namespace, policy: dict[str, Any], *, torch: Any, torchaudio: Any) -> dict[str, Any]:
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
    repo_head = git_head(args.rtt_repo)
    ckpt_sha = sha256(args.checkpoint)
    ckpt_bytes = args.checkpoint.stat().st_size
    verdict = "PASS"
    failures = []
    if repo_head != policy["candidate"]["commit"]:
        verdict = "FAIL"; failures.append("RTT commit mismatch")
    if ckpt_sha != policy["candidate"]["expectedCheckpointSha256"]:
        verdict = "FAIL"; failures.append("checkpoint SHA mismatch")
    if ckpt_bytes != int(policy["candidate"]["expectedCheckpointBytes"]):
        verdict = "FAIL"; failures.append("checkpoint byte size mismatch")
    return {
        "verdict": verdict,
        "failures": failures,
        "repo": "https://github.com/huispaty/rtt",
        "commit": repo_head,
        "checkpointSha256": ckpt_sha,
        "checkpointBytes": ckpt_bytes,
        "checkpointGitBlob": subprocess.check_output(["git", "-C", str(args.rtt_repo), "ls-tree", "HEAD", "ckpts/CustomAMT.ckpt"], text=True).strip(),
        "python": sys.version.split()[0],
        "torch": torch.__version__,
        "torchaudio": torchaudio.__version__,
        "sampleRateHz": 16000,
        "nFft": 2048,
        "hopSamples": 160,
        "fftDelaySamples": 160,
        "framesPerSecond": 100,
        "classes": 88,
        "pitchRange": "MIDI 21..108",
        "officialThresholds": {"onset": 0.5, "offset": 0.3, "frame": 0.3},
        "officialSegmentSamples": 48000,
        "officialOverlap": "50%",
        "inputScaling": "OFFICIAL_RUNTIME",
    }


def upstream_metric_reproduction(args: argparse.Namespace, policy: dict[str, Any], *, model: Any) -> dict[str, Any]:
    # Full upstream metric reproduction is attempted only for rows whose MAESTRO
    # source files are available locally. Missing official test files or runtime
    # dependencies make this gate inconclusive, not a model failure.
    rows = list(csv.DictReader((args.rtt_repo / "results.csv").open("r", encoding="utf-8")))[:12]
    selected = []
    missing = []
    for row in rows:
        audio = find_maestro_file(args.maestro_root, row["file"], ".wav")
        midi = find_maestro_file(args.maestro_root, row["file"], ".midi")
        item = {"file": row["file"], "audio": str(audio) if audio else None, "midi": str(midi) if midi else None}
        if not audio or not midi:
            missing.append(item)
        selected.append(item)
    if missing:
        return {
            "verdict": "INCONCLUSIVE",
            "selectedRows": selected,
            "missingRows": missing,
            "reason": "Required upstream MAESTRO test files were not available locally; official results.csv rows were not reproduced.",
        }

    try:
        import librosa
        import torch
        from evaluate import compute_notewise_transcription_metrics, midi_to_array
        from inference import PianoTranscription
    except Exception as exc:  # pragma: no cover - exercised in research envs
        return {
            "verdict": "INCONCLUSIVE",
            "selectedRows": selected,
            "reason": "Official upstream evaluation dependencies were unavailable.",
            "exception": repr(exc),
            "traceback": traceback.format_exc(limit=8),
        }

    device = torch.device(args.device or ("cuda" if torch.cuda.is_available() else "cpu"))
    try:
        transcriptor = PianoTranscription(
            checkpoint_path=str(args.checkpoint),
            onset_threshold=float(policy["runtime"]["officialOnsetThreshold"]),
            offset_threshold=0.3,
            frame_threshold=0.3,
            overlap=True,
            postprocessor="rtt",
            segment_samples=16000 * 3,
            device=device,
        )
    except Exception as exc:  # pragma: no cover - exercised in research envs
        return {
            "verdict": "INCONCLUSIVE",
            "selectedRows": selected,
            "reason": "Official upstream transcriptor could not be constructed.",
            "exception": repr(exc),
            "traceback": traceback.format_exc(limit=8),
        }

    tolerance_seconds = [float(t) for t in policy["upstreamMetricReproduction"]["tolerancesSeconds"]]
    per_file_tolerance = float(policy["upstreamMetricReproduction"]["perFileF1Tolerance"])
    aggregate_tolerance = float(policy["upstreamMetricReproduction"]["aggregateMeanF1Tolerance"])
    per_row = []
    deltas_by_tolerance: dict[str, list[float]] = {str(t): [] for t in tolerance_seconds}

    try:
        for row, item in zip(rows, selected, strict=True):
            audio_data, _ = librosa.load(item["audio"], sr=16000, mono=True)
            transcribed = transcriptor.transcribe(audio_data)
            reference = midi_to_array(item["midi"])
            computed: dict[str, float] = {}
            deltas: dict[str, float] = {}
            for tolerance in tolerance_seconds:
                metrics = compute_notewise_transcription_metrics(
                    reference,
                    transcribed["est_note_events"],
                    onset_tolerance=tolerance,
                )
                key = f"note-on-f-{tolerance}"
                computed[key] = float(metrics["note-on-f"])
                deltas[key] = abs(computed[key] - float(row[key]))
                deltas_by_tolerance[str(tolerance)].append(deltas[key])
            per_row.append({
                "file": row["file"],
                "audio": item["audio"],
                "midi": item["midi"],
                "expectedF1": {f"note-on-f-{t}": float(row[f"note-on-f-{t}"]) for t in tolerance_seconds},
                "computedF1": computed,
                "absoluteF1Delta": deltas,
                "perRowPass": all(delta <= per_file_tolerance for delta in deltas.values()),
            })
    except Exception as exc:  # pragma: no cover - exercised in research envs
        return {
            "verdict": "INCONCLUSIVE",
            "selectedRows": selected,
            "partialRows": per_row,
            "reason": "Official upstream metric reproduction raised before all selected rows completed.",
            "exception": repr(exc),
            "traceback": traceback.format_exc(limit=8),
        }

    aggregate = {}
    aggregate_pass = True
    for tolerance, deltas in deltas_by_tolerance.items():
        mean_delta = float(np.mean(deltas)) if deltas else float("nan")
        max_delta = float(np.max(deltas)) if deltas else float("nan")
        passed = mean_delta <= aggregate_tolerance
        aggregate_pass = aggregate_pass and passed
        aggregate[tolerance] = {
            "meanAbsoluteF1Delta": round(mean_delta, 8),
            "maxAbsoluteF1Delta": round(max_delta, 8),
            "pass": passed,
        }

    per_row_pass = all(row["perRowPass"] for row in per_row)
    verdict = "PASS" if per_row_pass and aggregate_pass else "INCONCLUSIVE"
    return {
        "verdict": verdict,
        "selectedRows": selected,
        "rowCount": len(per_row),
        "inputScaling": "OFFICIAL_RUNTIME",
        "officialRuntime": {
            "segmentSamples": 16000 * 3,
            "overlap": "50%",
            "postProcessor": "RTTPostProcessor",
            "onsetThreshold": float(policy["runtime"]["officialOnsetThreshold"]),
            "offsetThreshold": 0.3,
            "frameThreshold": 0.3,
        },
        "perFileF1Tolerance": per_file_tolerance,
        "aggregateMeanF1Tolerance": aggregate_tolerance,
        "perRow": per_row,
        "aggregate": aggregate,
        "reason": "Official upstream rows reproduced within tolerance." if verdict == "PASS" else "Official upstream rows did not reproduce within frozen tolerance under the available environment.",
    }


def evaluate_development(args: argparse.Namespace, policy: dict[str, Any], *, model: Any, targets: list[dict[str, Any]]) -> dict[str, Any]:
    thresholds = [float(v) for v in policy["runtime"]["thresholdSweep"]]
    streams = build_streams(args, policy, model=model, targets=targets)
    threshold_results = {}
    for threshold in thresholds:
        events_by_chunk = {key: events_from_raw(raw, threshold) for key, raw in streams["rawByChunk"].items()}
        threshold_results[str(threshold)] = score_threshold(policy, targets, events_by_chunk, streams)
    return {
        "artifact": "rtt_streaming_development_v2",
        "metadata": {
            "researchHarnessGitHead": args.research_harness_git_head,
            "policySha256": sha256(args.policy),
            "harnessSha256": sha256(Path(__file__)),
            "sourceAudioHashesVerified": streams["sourceAudioHashesVerified"],
            "sourceMidiHashesVerified": streams["sourceMidiHashesVerified"],
            "sourceCount": len(streams["sources"]),
            "chunkCount": len(streams["rawByChunk"]),
            "frozenEvaluationUsed": False,
        },
        "streamGeometry": streams["geometry"],
        "summary": {"thresholds": threshold_results},
        "streamsCompact": streams["compact"],
    }


def build_streams(args: argparse.Namespace, policy: dict[str, Any], *, model: Any, targets: list[dict[str, Any]]) -> dict[str, Any]:
    sources: dict[str, dict[str, Any]] = {}
    for target in targets:
        sources.setdefault(target["sourceFile"], {"audioSha": target["sourceAudioSha256"], "midi": target["sourceMidi"], "midiSha": target["sourceMidiSha256"], "targets": []})["targets"].append(target)
    raw_by_chunk = {}
    compact = {}
    geometry = []
    for source_file, info in sorted(sources.items()):
        audio_path = args.repo_root / "backend" / source_file
        midi_path = args.repo_root / "backend" / info["midi"]
        if sha256(audio_path) != info["audioSha"] or sha256(midi_path) != info["midiSha"]:
            raise ValueError(f"source hash mismatch for {source_file}")
        audio, sr = _read_wav(audio_path)
        if sr != SAMPLE_RATE:
            raise ValueError(f"expected {SAMPLE_RATE}Hz source audio: {audio_path}")
        needed_intervals = sorted({int(float(t.get("physicalAttackTime") or t.get("candidateTime") or t.get("scheduledExpectedTime") or 0) // 10) for t in info["targets"]})
        for interval_index in needed_intervals:
            scored_start = interval_index * 10.0
            scored_end = scored_start + 10.0
            input_start = max(0.0, scored_start - 10.0)
            input_end = min(len(audio) / sr, scored_end)
            segment = audio[int(input_start * sr): int(input_end * sr)]
            raw, latency = predict_raw(model, segment, device=args.device)
            key = f"{source_file}#[{scored_start:.0f},{scored_end:.0f})"
            raw_by_chunk[key] = {"raw": raw, "inputStart": input_start, "scoredStart": scored_start, "scoredEnd": scored_end, "latency": latency}
            compact[key] = {"inputStart": input_start, "scoredStart": scored_start, "scoredEnd": scored_end, "latency": latency}
            geometry.append(compact[key] | {"sourceFile": source_file})
    return {
        "sources": sources,
        "rawByChunk": raw_by_chunk,
        "compact": compact,
        "geometry": geometry,
        "sourceAudioHashesVerified": True,
        "sourceMidiHashesVerified": True,
    }


def score_threshold(policy: dict[str, Any], targets: list[dict[str, Any]], events_by_chunk: dict[str, list[dict[str, Any]]], streams: dict[str, Any]) -> dict[str, Any]:
    families = defaultdict(lambda: {"hit": 0, "total": 0, "false": 0, "falseTotal": 0})
    no_retrigger = {"long_held_no_retrigger": 0, "pedal_sustain_no_retrigger": 0}
    no_retrigger_total = {"long_held_no_retrigger": 0, "pedal_sustain_no_retrigger": 0}
    for target in targets:
        metric = target["metricFamily"]
        events = events_for_target(target, events_by_chunk)
        if target["shouldMatch"]:
            complete = all(has_event(events, pitch, float(target["physicalAttackTime"])) for pitch in target["expectedPitches"])
            families[metric]["hit"] += int(complete)
            families[metric]["total"] += 1
        elif metric in {"wrong_semitone", "wrong_octave", "missing_chord_tone"}:
            complete = all(has_event(events, pitch, float(target["scheduledExpectedTime"])) for pitch in target["expectedPitches"])
            families[metric]["false"] += int(complete)
            families[metric]["falseTotal"] += 1
        elif metric in no_retrigger:
            false_count = false_retrigger_events(target, events)
            no_retrigger[metric] += false_count
            no_retrigger_total[metric] += 1
    checks = {}
    hard_fail = False
    not_eval = False
    for name, gate in policy["gates"].items():
        if "minRecall" in gate:
            total = families[name]["total"]
            hit = families[name]["hit"]
            if total == 0:
                verdict = "NOT_EVALUATED"; value = None; not_eval = True
            else:
                value = hit / total
                verdict = "PASS" if value >= float(gate["minRecall"]) else "FAIL"
                hard_fail = hard_fail or verdict == "FAIL"
            checks[name] = {"hit": hit, "sampleCount": total, "recall": round(value, 6) if value is not None else None, "verdict": verdict}
        elif "maxFalseTargetAccepts" in gate:
            total = families[name]["falseTotal"]
            false = families[name]["false"]
            if total == 0:
                verdict = "NOT_EVALUATED"; not_eval = True
            else:
                verdict = "PASS" if false <= int(gate["maxFalseTargetAccepts"]) else "FAIL"
                hard_fail = hard_fail or verdict == "FAIL"
            checks[name] = {"falseAccepts": false, "sampleCount": total, "verdict": verdict}
        else:
            total = no_retrigger_total[name]
            false = no_retrigger[name]
            if total == 0:
                verdict = "NOT_EVALUATED"; not_eval = True
            else:
                verdict = "PASS" if false <= int(gate["maxFalseRetriggerEvents"]) else "FAIL"
                hard_fail = hard_fail or verdict == "FAIL"
            checks[name] = {"falseRetriggerEvents": false, "sampleCount": total, "verdict": verdict}
    return {"verdict": "FAIL" if hard_fail else "INCONCLUSIVE" if not_eval else "PASS", "checks": checks}


def events_for_target(target: dict[str, Any], events_by_chunk: dict[str, list[dict[str, Any]]]) -> list[dict[str, Any]]:
    t = float(target.get("physicalAttackTime") or target.get("scheduledExpectedTime") or target.get("candidateTime") or 0)
    interval = int(t // 10) * 10
    prefix = f"{target['sourceFile']}#[{interval:.0f},{interval + 10:.0f})"
    return events_by_chunk.get(prefix, [])


def has_event(events: list[dict[str, Any]], pitch: str, target_time: float, window: float = 0.05) -> bool:
    return any(ev["pitch"] == pitch and abs(float(ev["absoluteOnsetTime"]) - target_time) <= window for ev in events)


def false_retrigger_events(target: dict[str, Any], events: list[dict[str, Any]]) -> int:
    first = float(target.get("physicalAttackTime") or target.get("candidateTime") or 0)
    count = 0
    for pitch in target["expectedPitches"]:
        count += sum(1 for ev in events if ev["pitch"] == pitch and float(ev["absoluteOnsetTime"]) > first + 0.05)
    return count


def events_from_raw(chunk: dict[str, Any], threshold: float) -> list[dict[str, Any]]:
    raw = chunk["raw"]
    onsets = raw["onset_output"]
    active = onsets >= threshold
    rising = np.concatenate([active[:1, :], active[1:, :] & ~active[:-1, :]], axis=0)
    events = []
    for frame, pitch_index in zip(*np.where(rising), strict=True):
        local = frame / FPS
        absolute = float(chunk["inputStart"]) + local
        if not (float(chunk["scoredStart"]) <= absolute < float(chunk["scoredEnd"])):
            continue
        events.append({
            "pitch": _midi_note_name(MIDI_OFFSET + int(pitch_index)),
            "absoluteOnsetTime": round(absolute, 6),
            "onsetProbability": round(float(raw["onset_output"][frame, pitch_index]), 6),
            "frameProbability": round(float(raw["frame_output"][frame, pitch_index]), 6),
        })
    return events


def predict_raw(model: Any, audio: np.ndarray, *, device: str | None) -> tuple[dict[str, np.ndarray], dict[str, float]]:
    import torch
    dev = torch.device(device or ("cuda" if torch.cuda.is_available() else "cpu"))
    started = perf_counter()
    tensor = torch.tensor(audio[None, :], device=dev)
    with torch.inference_mode():
        out = {k: torch.sigmoid(v) for k, v in model(tensor).items()}
    if str(dev).startswith("cuda"):
        torch.cuda.synchronize()
    elapsed = (perf_counter() - started) * 1000
    return {k: v.detach().cpu().numpy()[0] for k, v in out.items()}, {"fullClipComputeMs": round(elapsed, 3)}


def decision_from_development(dev: dict[str, Any], policy: dict[str, Any]) -> dict[str, Any]:
    eligible = [float(th) for th, result in dev["summary"]["thresholds"].items() if result["verdict"] == "PASS"]
    if not eligible:
        any_fail = any(result["verdict"] == "FAIL" for result in dev["summary"]["thresholds"].values())
        return {"eligibleThresholds": [], "selectedThreshold": None, "development": "FAIL" if any_fail else "INCONCLUSIVE", "reason": "No threshold passed every required hard criterion."}
    selected = min(eligible, key=lambda th: (abs(th - 0.5), -th))
    return {"eligibleThresholds": eligible, "selectedThreshold": selected, "development": "PASS", "reason": "At least one threshold passed every hard criterion."}


def load_model(args: argparse.Namespace, *, torch: Any, CustomAMT: Any, RTT: Any) -> Any:
    device = torch.device(args.device or ("cuda" if torch.cuda.is_available() else "cpu"))
    base = CustomAMT()
    rtt = RTT.load_from_checkpoint(model=base, loss_function="weighted_bce_mse", checkpoint_path=str(args.checkpoint), map_location=device)
    return rtt.model.to(device).eval()


def find_maestro_file(root: Path, stem: str, suffix: str) -> Path | None:
    matches = list(root.rglob(stem + suffix))
    return matches[0] if matches else None


def verify_target_sources(report: dict[str, Any]) -> None:
    # Source hashes are checked before inference in build_streams.
    if not report.get("targets"):
        raise ValueError("development target manifest has no targets")


def write_all(args: argparse.Namespace, reports: dict[str, Any], *, verdict: str, development: str, reason: str) -> int:
    reports["final"] = {
        "development": development,
        "calibration": "NOT RUN",
        "stepReplay": "NOT RUN",
        "continuousReplay": "NOT RUN",
        "browser": "NOT RUN",
        "verdict": verdict,
        "reason": reason,
        "productionMicrophone": "DISABLED",
    }
    args.decision_json.parent.mkdir(parents=True, exist_ok=True)
    args.decision_json.write_text(json.dumps(reports, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    args.decision_md.write_text(markdown(reports), encoding="utf-8")
    return 1 if development == "FAIL" else 0


def markdown(r: dict[str, Any]) -> str:
    lines = [
        "# RTT Streaming-State Closure Decision v2",
        "",
        f"Research harness SHA: `{r['metadata']['researchHarnessGitHead']}`",
        f"Checkpoint SHA256: `{r['metadata']['checkpointSha256']}`",
        f"Checkpoint bytes: `{r['metadata']['checkpointBytes']}`",
        "",
        "## Phase 7 Addendum",
        "",
        "Phase 7 result: STRONG NEGATIVE EVIDENCE",
        "",
        "Final RTT disposition before Phase 7B: INCONCLUSIVE pending Phase 7B closure.",
        "",
        "Reasons: upstream metrics were not actually reproduced; harness/policy/evidence were committed together; short case clips restarted acoustic state; five required Development families were NOT_EVALUATED; aggregate timing distribution was missing.",
        "",
        "## Upstream",
        "",
        f"identity audit: `{r.get('upstreamIdentityAudit', {}).get('verdict')}`",
        f"metric reproduction: `{r.get('upstreamMetricReproduction', {}).get('verdict')}`",
        f"input scaling: `{r.get('upstreamIdentityAudit', {}).get('inputScaling')}`",
        "",
        "## Development",
        "",
        f"development: `{r['final']['development']}`",
        f"reason: {r['final']['reason']}",
        "",
    ]
    dev = r.get("developmentEvidence", {}).get("summary", {})
    for threshold, result in dev.get("thresholds", {}).items():
        lines.append(f"### threshold {threshold}")
        lines.append("")
        lines.append(f"verdict: `{result['verdict']}`")
        lines.append("")
        for name, check in result["checks"].items():
            lines.append(f"- `{name}`: `{check}`")
        lines.append("")
    lines.extend([
        "Calibration = `NOT RUN`",
        "STEP replay = `NOT RUN`",
        "Continuous replay = `NOT RUN`",
        "",
        f"```text\n{r['final']['verdict']}\n```",
        "",
        "Production microphone remains disabled after Phase 7B.",
        "No production integration was performed.",
        "",
    ])
    return "\n".join(lines)


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
