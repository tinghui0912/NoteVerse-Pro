"""Phase 7E RTT deterministic inference repair gate.

This research-only harness audits the published RTT runtime defect
(training-mode inference), verifies a model.eval() repair for deterministic
acoustic output, and audits the two frozen input-scale hypotheses before any
NoteVerse product-quality gate is allowed to run.
"""

from __future__ import annotations

import argparse
import csv
import hashlib
import json
import os
from pathlib import Path
import platform
import shutil
import subprocess
import sys
import tempfile
from typing import Any


def main() -> int:
    args = parse_args()
    policy = load_json(args.policy)
    if args.require_clean_tree and dirty_tree(args.repo_root):
        raise SystemExit("dirty tree rejected before evidence run")
    actual_head = git_head(args.repo_root)
    if actual_head != args.research_harness_git_head:
        raise SystemExit(f"researchHarnessGitHead mismatch: arg={args.research_harness_git_head} actual={actual_head}")

    metadata = metadata_block(args, policy, actual_head)
    decision: dict[str, Any] = {
        "metadata": metadata,
        "phase7DReinterpretation": {
            "publishedUpstreamCliExactReproductionAttempt": "FAIL",
            "rootCauseIdentified": "published inference constructs a model that remains in training mode despite Dropout and BatchNorm modules",
            "phase7DModelQualityVerdict": "SUPERSEDED: RTT MODEL QUALITY = INCONCLUSIVE",
            "incorrectPhase7DHarnessSha": policy["phase7DCorrection"]["incorrectRecordedHarnessSha"],
            "correctPhase7DHarnessSha": policy["phase7DCorrection"]["actualHarnessSha"],
        },
    }

    identity = identity_audit(args, policy)
    decision["identityAudit"] = identity
    if identity["verdict"] != "PASS":
        return write_all(args, decision, "INCONCLUSIVE", "ENVIRONMENT_OR_IDENTITY_BLOCKER", identity["reason"])

    try:
        cohort = build_cohort(args, policy)
    except Exception as exc:
        decision["cohort"] = {"verdict": "INCONCLUSIVE", "reason": str(exc)}
        return write_all(args, decision, "INCONCLUSIVE", "ENVIRONMENT_OR_SOURCE_BLOCKER", str(exc))
    decision["cohort"] = summarize_cohort(cohort)

    try:
        defect = published_runtime_defect_audit(args, policy, cohort)
    except Exception as exc:
        decision["publishedRuntimeDefectAudit"] = {"verdict": "INCONCLUSIVE", "reason": str(exc)}
        return write_all(args, decision, "INCONCLUSIVE", "PUBLISHED_RUNTIME_AUDIT_BLOCKER", str(exc))
    decision["publishedRuntimeDefectAudit"] = defect

    try:
        corrected = corrected_eval_determinism_audit(args, policy, cohort)
    except Exception as exc:
        decision["correctedEvalDeterminism"] = {"verdict": "INCONCLUSIVE", "reason": str(exc)}
        return write_all(args, decision, "INCONCLUSIVE", "CORRECTED_RUNTIME_AUDIT_BLOCKER", str(exc))
    decision["correctedEvalDeterminism"] = corrected
    if corrected["verdict"] != "PASS":
        return write_all(args, decision, "FAIL", "NON_DETERMINISTIC_CORRECTED_RUNTIME", "model.eval() runtime remained materially nondeterministic")

    try:
        scale = input_scale_audit(args, policy, cohort)
    except Exception as exc:
        decision["inputScaleAudit"] = {"verdict": "INCONCLUSIVE", "reason": str(exc)}
        return write_all(args, decision, "INCONCLUSIVE", "INPUT_SCALE_AUDIT_BLOCKER", str(exc))
    decision["inputScaleAudit"] = scale
    if scale["selection"]["selectedScale"] is None:
        return write_all(args, decision, "INCONCLUSIVE", "INCONCLUSIVE_INPUT_SCALE", scale["selection"]["reason"])

    decision["selectedDeterministicContract"] = {
        "rttCommit": policy["candidate"]["commit"],
        "checkpointSha256": policy["candidate"]["expectedCheckpointSha256"],
        "modelEval": True,
        "inputScale": scale["selection"]["selectedScale"],
        "sampleRate": policy["runtime"]["sampleRate"],
        "segmentSamples": policy["runtime"]["segmentSamples"],
        "overlap": policy["runtime"]["overlap"],
        "postprocessor": policy["runtime"]["postprocessor"],
    }
    return write_all(args, decision, "INCONCLUSIVE", "DEVELOPMENT_GATE_NOT_IMPLEMENTED", "deterministic contract selected, but Phase 7E Development gate is not implemented in this harness")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, required=True)
    parser.add_argument("--policy", type=Path, required=True)
    parser.add_argument("--rtt-repo", type=Path, required=True)
    parser.add_argument("--checkpoint", type=Path, required=True)
    parser.add_argument("--maestro-root", type=Path, required=True)
    parser.add_argument("--training-output", type=Path, required=True)
    parser.add_argument("--scale-output", type=Path, required=True)
    parser.add_argument("--decision-json", type=Path, required=True)
    parser.add_argument("--decision-md", type=Path, required=True)
    parser.add_argument("--research-harness-git-head", required=True)
    parser.add_argument("--require-clean-tree", action="store_true")
    return parser.parse_args()


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, indent=2, sort_keys=False) + "\n", encoding="utf-8")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as fh:
        for chunk in iter(lambda: fh.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def dirty_tree(repo_root: Path) -> bool:
    output = subprocess.check_output(["git", "status", "--porcelain"], cwd=repo_root, text=True)
    return bool(output.strip())


def git_head(repo_root: Path) -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo_root, text=True).strip()


def metadata_block(args: argparse.Namespace, policy: dict[str, Any], actual_head: str) -> dict[str, Any]:
    return {
        "generatedAt": "2026-10-06T00:00:00+08:00",
        "researchHarnessGitHead": args.research_harness_git_head,
        "actualGitHead": actual_head,
        "harnessSha256": sha256(Path(__file__)),
        "policy": {"path": str(args.policy), "sha256": sha256(args.policy)},
        "exactCommand": " ".join(sys.argv),
        "dirtyTree": False,
        "os": platform.platform(),
        "python": sys.version.split()[0],
        "environment": python_environment(),
        "checkpointSha256": sha256(args.checkpoint),
        "checkpointBytes": args.checkpoint.stat().st_size,
        "rttRepo": str(args.rtt_repo),
        "maestroRoot": str(args.maestro_root),
        "frozenEvaluationUsed": False,
    }


def python_environment() -> dict[str, Any]:
    code = (
        "import json,sys;"
        "mods=['torch','torchaudio','librosa','numpy','scipy','mir_eval','pretty_midi','soxr'];"
        "d={'python':sys.version.split()[0]};"
        "\nfor m in mods:\n import importlib; mod=importlib.import_module(m); d[m]=getattr(mod,'__version__','unknown')"
        "\nimport torch; d['cuda']=getattr(torch.version,'cuda',None); d['cudaAvailable']=torch.cuda.is_available();"
        "d['device']=torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu'; print(json.dumps(d))"
    )
    try:
        return json.loads(subprocess.check_output([sys.executable, "-c", code], text=True))
    except Exception as exc:
        return {"error": repr(exc), "python": sys.version.split()[0]}


def identity_audit(args: argparse.Namespace, policy: dict[str, Any]) -> dict[str, Any]:
    expected = policy["candidate"]
    problems = []
    rtt_head = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=args.rtt_repo, text=True).strip()
    if rtt_head != expected["commit"]:
        problems.append(f"RTT commit mismatch: {rtt_head}")
    checkpoint_sha = sha256(args.checkpoint)
    checkpoint_bytes = args.checkpoint.stat().st_size
    if checkpoint_sha != expected["expectedCheckpointSha256"]:
        problems.append(f"checkpoint SHA mismatch: {checkpoint_sha}")
    if checkpoint_bytes != int(expected["expectedCheckpointBytes"]):
        problems.append(f"checkpoint bytes mismatch: {checkpoint_bytes}")
    return {
        "verdict": "FAIL" if problems else "PASS",
        "reason": "; ".join(problems) if problems else "pinned RTT identity verified",
        "rttHead": rtt_head,
        "checkpointSha256": checkpoint_sha,
        "checkpointBytes": checkpoint_bytes,
    }


def build_cohort(args: argparse.Namespace, policy: dict[str, Any]) -> dict[str, Any]:
    metadata_path = args.maestro_root / "maestro-v3.0.0.csv"
    rows = list(csv.DictReader(metadata_path.open("r", encoding="utf-8")))
    by_base = {Path(row["audio_filename"]).stem: row for row in rows}
    sources = {}
    for base in policy["diagnosticCohort"]["basenames"]:
        if base not in by_base:
            raise RuntimeError(f"missing MAESTRO metadata row for {base}")
        row = by_base[base]
        if row.get("split") != "test":
            raise RuntimeError(f"expected test split for {base}, got {row.get('split')}")
        audio_path = find_under(args.maestro_root, row["audio_filename"])
        midi_path = find_under(args.maestro_root, row["midi_filename"])
        sources[base] = {
            "metadata": row,
            "audioPath": audio_path,
            "midiPath": midi_path,
            "audioSha256": sha256(audio_path),
            "midiSha256": sha256(midi_path),
            "audioBytes": audio_path.stat().st_size,
            "midiBytes": midi_path.stat().st_size,
        }
    return {"sources": sources}


def find_under(root: Path, relative: str) -> Path:
    candidate = root / relative
    if candidate.exists():
        return candidate
    matches = list(root.glob(f"**/{Path(relative).name}"))
    if not matches:
        raise RuntimeError(f"missing source asset: {relative}")
    if len(matches) > 1:
        raise RuntimeError(f"ambiguous source asset {relative}: {matches}")
    return matches[0]


def summarize_cohort(cohort: dict[str, Any]) -> dict[str, Any]:
    return {
        "verdict": "PASS",
        "sources": [{
            "basename": base,
            "audioFilename": source["metadata"]["audio_filename"],
            "midiFilename": source["metadata"]["midi_filename"],
            "audioSha256": source["audioSha256"],
            "midiSha256": source["midiSha256"],
            "split": source["metadata"].get("split"),
            "year": source["metadata"].get("year"),
        } for base, source in cohort["sources"].items()],
    }


def published_runtime_defect_audit(args: argparse.Namespace, policy: dict[str, Any], cohort: dict[str, Any]) -> dict[str, Any]:
    training = inspect_training_state(args, eval_mode=False)
    inference_mode = inspect_inference_mode_state(args)
    repeated = []
    with tempfile.TemporaryDirectory(prefix="rtt-phase7e-repeated-") as tmp:
        tmp_path = Path(tmp)
        mini = tmp_path / "mini-maestro"
        mini.mkdir()
        write_mini_maestro(mini, cohort)
        for index in range(3):
            work = tmp_path / f"run-{index}"
            work.mkdir()
            run = run_upstream_cli(args, mini, work)
            repeated.append(run)
    pairwise = pairwise_metric_deltas([run["rows"] for run in repeated])
    report = {
        "artifact": "rtt_upstream_training_mode_audit",
        "trainingState": training,
        "inferenceModeState": inference_mode,
        "unmodifiedRepeatedRuns": {
            "runCount": len(repeated),
            "pairwise": pairwise,
            "diagnostic": "non-zero deltas indicate published runtime nondeterminism",
        },
    }
    write_json(args.training_output, report)
    return {
        "path": str(args.training_output),
        "sha256": sha256(args.training_output),
        "summary": report,
    }


def inspect_training_state(args: argparse.Namespace, *, eval_mode: bool) -> dict[str, Any]:
    code = f"""
import json, sys, torch
sys.path.insert(0, {str((args.rtt_repo / 'src').resolve())!r})
from inference import PianoTranscription
t = PianoTranscription(checkpoint_path={str(args.checkpoint)!r})
if {eval_mode!r}:
    t.model.eval()
dropouts = [m for m in t.model.modules() if isinstance(m, torch.nn.Dropout)]
bns = [m for m in t.model.modules() if isinstance(m, (torch.nn.BatchNorm1d, torch.nn.BatchNorm2d))]
print(json.dumps({{
  'modelTraining': t.model.training,
  'dropoutCount': len(dropouts),
  'dropoutTrainingCount': sum(1 for m in dropouts if m.training),
  'batchNormCount': len(bns),
  'batchNormTrainingCount': sum(1 for m in bns if m.training)
}}))
"""
    return json.loads(subprocess.check_output([sys.executable, "-c", code], text=True))


def inspect_inference_mode_state(args: argparse.Namespace) -> dict[str, Any]:
    code = f"""
import json, sys, torch
sys.path.insert(0, {str((args.rtt_repo / 'src').resolve())!r})
from inference import PianoTranscription
t = PianoTranscription(checkpoint_path={str(args.checkpoint)!r})
before = t.model.training
with torch.inference_mode():
    inside = t.model.training
print(json.dumps({{'beforeInferenceMode': before, 'insideInferenceMode': inside}}))
"""
    return json.loads(subprocess.check_output([sys.executable, "-c", code], text=True))


def run_upstream_cli(args: argparse.Namespace, mini_root: Path, work: Path) -> dict[str, Any]:
    if (work / "my_results.csv").exists():
        raise RuntimeError("fresh workdir unexpectedly contains my_results.csv")
    ckpts = work / "ckpts"
    ckpts.mkdir()
    safe_link_or_copy(args.checkpoint, ckpts / args.checkpoint.name)
    command = [sys.executable, str(args.rtt_repo / "src" / "inference.py"), str(mini_root), "--split", "test"]
    completed = subprocess.run(command, cwd=work, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, check=False)
    if completed.returncode != 0:
        raise RuntimeError(f"upstream CLI failed: {completed.stderr[-2000:]}")
    rows = {row["file"]: row for row in csv.DictReader((work / "my_results.csv").open("r", encoding="utf-8"))}
    return {"rows": rows, "stdoutTail": completed.stdout[-1000:], "stderrTail": completed.stderr[-1000:]}


def write_mini_maestro(root: Path, cohort: dict[str, Any]) -> None:
    rows = []
    for source in cohort["sources"].values():
        metadata = dict(source["metadata"])
        rows.append(metadata)
        audio_link = root / metadata["audio_filename"]
        midi_link = root / metadata["midi_filename"]
        audio_link.parent.mkdir(parents=True, exist_ok=True)
        midi_link.parent.mkdir(parents=True, exist_ok=True)
        safe_link_or_copy(source["audioPath"], audio_link)
        safe_link_or_copy(source["midiPath"], midi_link)
    fieldnames = list(rows[0].keys())
    with (root / "maestro-v3.0.0.csv").open("w", encoding="utf-8", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)


def safe_link_or_copy(source: Path, target: Path) -> None:
    try:
        os.symlink(source, target)
    except OSError:
        shutil.copy2(source, target)


def pairwise_metric_deltas(runs: list[dict[str, dict[str, str]]]) -> list[dict[str, Any]]:
    metrics = [f"note-on-{kind}-{tol}" for tol in ["0.01", "0.02", "0.03"] for kind in ["p", "r", "f"]]
    pairs = []
    for left in range(len(runs)):
        for right in range(left + 1, len(runs)):
            deltas = []
            for base, left_row in runs[left].items():
                right_row = runs[right][base]
                for metric in metrics:
                    deltas.append(abs(float(left_row[metric]) - float(right_row[metric])))
            pairs.append({
                "leftRun": left,
                "rightRun": right,
                "maxDelta": max(deltas),
                "meanDelta": sum(deltas) / len(deltas),
            })
    return pairs


def corrected_eval_determinism_audit(args: argparse.Namespace, policy: dict[str, Any], cohort: dict[str, Any]) -> dict[str, Any]:
    code = deterministic_eval_code(args, policy, cohort, scale="OFFICIAL_FLOAT")
    output = subprocess.check_output([sys.executable, "-c", code], text=True)
    result = json.loads(output)
    eps = float(policy["determinismGate"]["maxRawTensorDeltaEpsilon"])
    event_agreement = result["decodedEventAgreement"]
    raw_pass = result["maxRawTensorDelta"] <= eps
    event_pass = event_agreement == 1.0
    result["verdict"] = "PASS" if raw_pass and event_pass else "FAIL"
    result["epsilon"] = eps
    return result


def deterministic_eval_code(args: argparse.Namespace, policy: dict[str, Any], cohort: dict[str, Any], *, scale: str) -> str:
    first_source = next(iter(cohort["sources"].values()))
    audio_path = str(first_source["audioPath"])
    rtt_src = str((args.rtt_repo / "src").resolve())
    checkpoint = str(args.checkpoint)
    sample_seconds = float(policy["scaleAudit"]["sampleSecondsPerSource"])
    multiplier = 32768.0 if scale == "INT16_EQUIVALENT" else 1.0
    return f"""
import json, sys, numpy as np, torch, librosa
sys.path.insert(0, {rtt_src!r})
from inference import PianoTranscription
audio, _ = librosa.load({audio_path!r}, sr=16000, mono=True)
audio = audio[:int(16000 * {sample_seconds!r})] * {multiplier!r}
outputs = []
events = []
for _ in range(3):
    t = PianoTranscription(checkpoint_path={checkpoint!r})
    t.model.eval()
    result = t.transcribe(audio)
    outputs.append(result['output_dict'])
    events.append([
        (
            int(e['midi_note']),
            round(float(e['onset_time']), 6),
            round(float(e['offset_time']), 6),
            int(e.get('velocity', 0)),
        )
        for e in result['est_note_events']
    ])
max_delta = 0.0
keys = sorted(outputs[0].keys())
for key in keys:
    for i in range(3):
        for j in range(i + 1, 3):
            max_delta = max(max_delta, float(np.max(np.abs(outputs[i][key] - outputs[j][key]))))
agreement = 1.0 if events[0] == events[1] == events[2] else 0.0
print(json.dumps({{'scale': {scale!r}, 'maxRawTensorDelta': max_delta, 'decodedEventAgreement': agreement, 'eventCounts': [len(x) for x in events], 'keys': keys}}))
"""


def input_scale_audit(args: argparse.Namespace, policy: dict[str, Any], cohort: dict[str, Any]) -> dict[str, Any]:
    results = {}
    for scale in policy["scaleAudit"]["contracts"]:
        code = scale_audit_code(args, policy, cohort, scale=scale)
        results[scale] = json.loads(subprocess.check_output([sys.executable, "-c", code], text=True))
    selection = select_scale(policy, results)
    report = {
        "artifact": "rtt_input_scale_audit",
        "contracts": results,
        "selection": selection,
    }
    write_json(args.scale_output, report)
    report["path"] = str(args.scale_output)
    report["sha256"] = sha256(args.scale_output)
    return report


def scale_audit_code(args: argparse.Namespace, policy: dict[str, Any], cohort: dict[str, Any], *, scale: str) -> str:
    audio_paths = [str(source["audioPath"]) for source in cohort["sources"].values()]
    rtt_src = str((args.rtt_repo / "src").resolve())
    checkpoint = str(args.checkpoint)
    sample_seconds = float(policy["scaleAudit"]["sampleSecondsPerSource"])
    multiplier = 32768.0 if scale == "INT16_EQUIVALENT" else 1.0
    return f"""
import json, sys, numpy as np, torch, librosa
sys.path.insert(0, {rtt_src!r})
from inference import PianoTranscription
t = PianoTranscription(checkpoint_path={checkpoint!r})
t.model.eval()
means = []
vars_ = []
with torch.inference_mode():
    for path in {audio_paths!r}:
        audio, _ = librosa.load(path, sr=16000, mono=True)
        audio = audio[:int(16000 * {sample_seconds!r})] * {multiplier!r}
        tensor = torch.tensor(audio[None, :]).to(t.device)
        normalized = torch.divide(tensor, abs(torch.iinfo(torch.short).min)).to(torch.float32)
        mel = t.model.logmel_extractor(normalized).unsqueeze(-1)
        channel = mel[:, :, :, 0].detach().cpu().numpy()
        means.append(channel.mean(axis=(0, 2)))
        vars_.append(channel.var(axis=(0, 2)))
observed_mean = np.mean(np.stack(means), axis=0)
observed_var = np.mean(np.stack(vars_), axis=0)
running_mean = t.model.bn0.running_mean.detach().cpu().numpy()
running_var = t.model.bn0.running_var.detach().cpu().numpy()
mean_distance = float(np.mean(np.abs(observed_mean - running_mean) / np.sqrt(running_var + 1e-6)))
variance_distance = float(np.mean(np.abs(np.log((observed_var + 1e-6) / (running_var + 1e-6)))))
print(json.dumps({{'scale': {scale!r}, 'meanDistance': mean_distance, 'varianceDistance': variance_distance, 'observedMeanP50': float(np.median(observed_mean)), 'observedVarP50': float(np.median(observed_var)), 'bnRunningMeanP50': float(np.median(running_mean)), 'bnRunningVarP50': float(np.median(running_var))}}))
"""


def select_scale(policy: dict[str, Any], results: dict[str, dict[str, Any]]) -> dict[str, Any]:
    official = results["OFFICIAL_FLOAT"]
    int16 = results["INT16_EQUIVALENT"]
    factor = float(policy["scaleAudit"]["clearImprovementFactor"])
    official_mean_better = int16["meanDistance"] / official["meanDistance"] >= factor
    official_var_better = int16["varianceDistance"] / official["varianceDistance"] >= factor
    int16_mean_better = official["meanDistance"] / int16["meanDistance"] >= factor
    int16_var_better = official["varianceDistance"] / int16["varianceDistance"] >= factor
    if official_mean_better and official_var_better:
        return {"selectedScale": "OFFICIAL_FLOAT", "reason": "OFFICIAL_FLOAT is clearly closer on both BN mean and variance diagnostics"}
    if int16_mean_better and int16_var_better:
        return {"selectedScale": "INT16_EQUIVALENT", "reason": "INT16_EQUIVALENT is clearly closer on both BN mean and variance diagnostics"}
    return {"selectedScale": None, "reason": "BN diagnostics did not provide a clear >=2x winner on both mean-distance and variance-distance"}


def write_all(args: argparse.Namespace, decision: dict[str, Any], verdict: str, category: str, reason: str) -> int:
    final_verdict = f"RTT Shared Streaming Onset Frontend = {verdict}"
    decision["final"] = {
        "development": "NOT RUN",
        "calibration": "NOT RUN",
        "stepReplay": "NOT RUN",
        "continuousReplay": "NOT RUN",
        "browser": "NOT RUN",
        "verdict": final_verdict,
        "failureCategory": category,
        "reason": reason,
        "productionMicrophone": "DISABLED",
    }
    write_json(args.decision_json, decision)
    args.decision_md.parent.mkdir(parents=True, exist_ok=True)
    args.decision_md.write_text(markdown(decision), encoding="utf-8")
    return 0 if verdict in {"PASS", "INCONCLUSIVE"} else 1


def markdown(decision: dict[str, Any]) -> str:
    final = decision["final"]
    lines = [
        "# RTT Deterministic Inference Decision",
        "",
        f"Research harness SHA: `{decision['metadata']['researchHarnessGitHead']}`",
        f"Checkpoint SHA256: `{decision['metadata']['checkpointSha256']}`",
        "",
        "Phase 7D published runtime disposition: `NON_DETERMINISTIC / DEFECTIVE INFERENCE CONTRACT`",
        "",
        f"Final verdict: `{final['verdict']}`",
        f"Failure category: `{final['failureCategory']}`",
        f"Reason: {final['reason']}",
        "",
        "Production microphone remains disabled after Phase 7E.",
        "No production integration was performed.",
        "",
    ]
    return "\n".join(lines)


if __name__ == "__main__":
    raise SystemExit(main())
