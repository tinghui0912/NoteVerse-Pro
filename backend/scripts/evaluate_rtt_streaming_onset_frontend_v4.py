"""Phase 7D exact-upstream RTT reproduction terminal gate.

This research-only harness creates a mini-MAESTRO root for the frozen 8-row
cohort, runs the unmodified pinned RTT CLI in a fresh working directory, and
compares the generated my_results.csv with the pinned upstream results.csv.
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
import wave


def main() -> int:
    args = parse_args()
    policy = load_json(args.policy)
    if args.require_clean_tree and dirty_tree(args.repo_root):
        raise SystemExit("dirty tree rejected before evidence run")

    metadata = metadata_block(args, policy)
    decision: dict[str, Any] = {
        "metadata": metadata,
        "phase7Interpretation": {
            "phase7": "STRONG NEGATIVE EVIDENCE",
            "phase7B": "INCONCLUSIVE",
            "phase7C": "INCONCLUSIVE",
            "phase7D": "terminal RTT exact-upstream reproduction gate",
        },
    }
    identity = identity_audit(args, policy)
    decision["upstreamIdentityAudit"] = identity
    if identity["verdict"] != "PASS":
        return write_decision(args, decision, "INCONCLUSIVE", "ENVIRONMENT_OR_IDENTITY_BLOCKER", "upstream identity audit failed")

    try:
        cohort = build_reproduction_cohort(args, policy)
    except Exception as exc:
        decision["upstreamMetricReproduction"] = {"verdict": "INCONCLUSIVE", "reason": str(exc)}
        return write_decision(args, decision, "INCONCLUSIVE", "ENVIRONMENT_OR_SOURCE_BLOCKER", str(exc))

    decision["officialMetadataVerification"] = summarize_sources(cohort)
    try:
        cli = run_unmodified_upstream_cli(args, cohort)
    except Exception as exc:
        decision["upstreamMetricReproduction"] = {"verdict": "INCONCLUSIVE", "reason": str(exc)}
        return write_decision(args, decision, "INCONCLUSIVE", "ENVIRONMENT_OR_RUNTIME_BLOCKER", str(exc))

    try:
        wrapper = run_noteverse_wrapper(args, policy, cohort)
        wrapper_agreement = compare_rows_exact(policy, expected_rows=cli["rows"], computed_rows=wrapper["rows"])
    except Exception as exc:
        decision["upstreamMetricReproduction"] = {"verdict": "INCONCLUSIVE", "reason": f"CLI completed but wrapper cross-check failed: {exc}"}
        return write_decision(args, decision, "INCONCLUSIVE", "WRAPPER_CROSS_CHECK_BLOCKER", str(exc))

    comparison = compare_results(policy, expected_rows=cohort["resultsRows"], computed_rows=cli["rows"])
    upstream_report = {
        "artifact": "rtt_upstream_reproduction_v4",
        "verdict": "PASS" if comparison["pass"] else "FAIL",
        "cohort": list(cohort["sources"].keys()),
        "officialCli": cli,
        "noteVerseWrapper": wrapper,
        "cliVsWrapperAgreement": wrapper_agreement,
        "comparison": comparison,
        "sourceVerification": summarize_sources(cohort),
        "environment": exact_environment(args),
    }
    write_json(args.upstream_output, upstream_report)
    decision["upstreamMetricReproduction"] = {
        "path": str(args.upstream_output),
        "sha256": sha256(args.upstream_output),
        "summary": {
            "verdict": upstream_report["verdict"],
            "aggregate": comparison["aggregate"],
            "perRowPassCount": sum(1 for row in comparison["perRow"] if row["perFileF1Pass"]),
            "rowCount": len(comparison["perRow"]),
        },
    }
    if upstream_report["verdict"] != "PASS":
        return write_decision(args, decision, "FAIL", "UPSTREAM_REPRODUCIBILITY_FAILURE", "official upstream CLI did not reproduce pinned results.csv")

    # Development intentionally stays behind the upstream reproducibility gate.
    return write_decision(args, decision, "INCONCLUSIVE", "DEVELOPMENT_NOT_RUN", "upstream passed but Development was not executed by this harness")


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--repo-root", type=Path, required=True)
    p.add_argument("--policy", type=Path, required=True)
    p.add_argument("--rtt-repo", type=Path, required=True)
    p.add_argument("--checkpoint", type=Path, required=True)
    p.add_argument("--maestro-root", type=Path, required=True)
    p.add_argument("--upstream-output", type=Path, required=True)
    p.add_argument("--decision-json", type=Path, required=True)
    p.add_argument("--decision-md", type=Path, required=True)
    p.add_argument("--research-harness-git-head", required=True)
    p.add_argument("--require-clean-tree", action="store_true")
    return p.parse_args()


def metadata_block(args: argparse.Namespace, policy: dict[str, Any]) -> dict[str, Any]:
    return {
        "generatedAt": "2026-10-05T00:00:00+08:00",
        "researchHarnessGitHead": args.research_harness_git_head,
        "harnessSha256": sha256(Path(__file__)),
        "policy": {"path": str(args.policy), "sha256": sha256(args.policy)},
        "exactCommand": " ".join(sys.argv),
        "dirtyTree": dirty_tree(args.repo_root),
        "os": platform.platform(),
        "python": sys.version.split()[0],
        "rttUpstreamCommit": git_head(args.rtt_repo),
        "checkpointSha256": sha256(args.checkpoint),
        "checkpointBytes": args.checkpoint.stat().st_size,
        "upstreamResultsCsvSha256": sha256(args.rtt_repo / "results.csv"),
        "frozenEvaluationUsed": False,
    }


def identity_audit(args: argparse.Namespace, policy: dict[str, Any]) -> dict[str, Any]:
    failures = []
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
        "commit": git_head(args.rtt_repo),
        "checkpointSha256": sha256(args.checkpoint),
        "checkpointBytes": args.checkpoint.stat().st_size,
        "resultsCsvSha256": sha256(args.rtt_repo / "results.csv"),
    }


def build_reproduction_cohort(args: argparse.Namespace, policy: dict[str, Any]) -> dict[str, Any]:
    frozen = list(policy["upstreamMetricReproduction"]["frozenBasenames"])
    maestro_rows = list(csv.DictReader((args.maestro_root / "maestro-v3.0.0.csv").open("r", encoding="utf-8")))
    results_rows = list(csv.DictReader((args.rtt_repo / "results.csv").open("r", encoding="utf-8")))
    maestro_by_base = {Path(row["audio_filename"]).stem: row for row in maestro_rows}
    results_by_base = {row["file"]: row for row in results_rows}
    sources = {}
    for base in frozen:
        if base not in maestro_by_base:
            raise ValueError(f"frozen source missing from official MAESTRO metadata: {base}")
        if base not in results_by_base:
            raise ValueError(f"frozen source missing from pinned RTT results.csv: {base}")
        row = maestro_by_base[base]
        if row.get("split") != "test":
            raise ValueError(f"frozen source is not test split: {base}")
        audio = args.maestro_root / row["audio_filename"]
        midi = args.maestro_root / row["midi_filename"]
        if not audio.exists() or not midi.exists():
            raise ValueError(f"frozen source asset missing: {base}")
        sources[base] = {
            "basename": base,
            "metadata": row,
            "audioPath": audio,
            "midiPath": midi,
            "asset": wav_metadata(audio) | {
                "path": str(audio),
                "sha256": sha256(audio),
                "bytes": audio.stat().st_size,
                "midiPath": str(midi),
                "midiSha256": sha256(midi),
                "midiBytes": midi.stat().st_size,
            },
        }
    return {"sources": sources, "resultsRows": {base: results_by_base[base] for base in frozen}}


def run_unmodified_upstream_cli(args: argparse.Namespace, cohort: dict[str, Any]) -> dict[str, Any]:
    with tempfile.TemporaryDirectory(prefix="rtt-7d-") as td:
        work = Path(td)
        mini = work / "mini-maestro"
        mini.mkdir()
        write_mini_maestro(mini, cohort)
        ckpt_link = work / "ckpts"
        try:
            ckpt_link.symlink_to(args.rtt_repo / "ckpts", target_is_directory=True)
        except OSError:
            shutil.copytree(args.rtt_repo / "ckpts", ckpt_link)
        output = work / "my_results.csv"
        if output.exists():
            raise ValueError("fresh upstream workdir unexpectedly contains my_results.csv")
        command = [sys.executable, str(args.rtt_repo / "src" / "inference.py"), str(mini), "--split", "test"]
        completed = subprocess.run(command, cwd=work, text=True, capture_output=True, check=False)
        if completed.returncode != 0:
            raise RuntimeError(f"upstream CLI failed with code {completed.returncode}\nSTDOUT:\n{completed.stdout[-4000:]}\nSTDERR:\n{completed.stderr[-4000:]}")
        if not output.exists():
            raise RuntimeError("upstream CLI did not produce my_results.csv")
        rows = list(csv.DictReader(output.open("r", encoding="utf-8")))
        expected = set(cohort["sources"].keys())
        actual = [row["file"] for row in rows]
        if len(rows) != 8 or set(actual) != expected or len(actual) != len(set(actual)):
            raise RuntimeError(f"upstream CLI produced invalid result row set: {actual}")
        saved = args.upstream_output.parent / "rtt_upstream_cli_my_results_v4_2026-10-05.csv"
        saved.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(output, saved)
        return {
            "command": " ".join(command),
            "returnCode": completed.returncode,
            "stdoutTail": completed.stdout[-2000:],
            "stderrTail": completed.stderr[-2000:],
            "myResultsPath": str(saved),
            "myResultsSha256": sha256(saved),
            "rows": {row["file"]: row for row in rows},
        }


def run_noteverse_wrapper(args: argparse.Namespace, policy: dict[str, Any], cohort: dict[str, Any]) -> dict[str, Any]:
    """Cross-check the official CLI through a second NoteVerse-managed wrapper run.

    The terminal gate treats the unmodified upstream CLI as authoritative. This
    wrapper therefore does not reimplement RTT internals; it proves the
    NoteVerse harness can recreate the exact same mini-MAESTRO invocation in an
    independent fresh working directory.
    """
    with tempfile.TemporaryDirectory(prefix="rtt-phase7d-wrapper-") as tmp:
        tmp_path = Path(tmp)
        mini = tmp_path / "mini-maestro"
        work = tmp_path / "wrapper-work"
        mini.mkdir()
        work.mkdir()
        write_mini_maestro(mini, cohort)
        if (work / "my_results.csv").exists():
            raise RuntimeError("wrapper workdir unexpectedly contains my_results.csv")
        ckpt_link = work / "ckpts"
        ckpt_link.mkdir()
        safe_link_or_copy(args.checkpoint, ckpt_link / args.checkpoint.name)
        command = [sys.executable, str(args.rtt_repo / "src" / "inference.py"), str(mini), "--split", "test"]
        completed = subprocess.run(
            command,
            cwd=work,
            text=True,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            check=False,
        )
        output = work / "my_results.csv"
        if completed.returncode != 0:
            raise RuntimeError(f"wrapper CLI failed with code {completed.returncode}\nSTDOUT:\n{completed.stdout[-4000:]}\nSTDERR:\n{completed.stderr[-4000:]}")
        if not output.exists():
            raise RuntimeError("wrapper CLI did not produce my_results.csv")
        rows = list(csv.DictReader(output.open("r", encoding="utf-8")))
        expected = set(cohort["sources"].keys())
        actual = [row["file"] for row in rows]
        if len(rows) != 8 or set(actual) != expected or len(actual) != len(set(actual)):
            raise RuntimeError(f"wrapper CLI produced invalid result row set: {actual}")
        return {
            "rows": {row["file"]: row for row in rows},
            "runtime": "NoteVerse wrapper invoking the unmodified upstream CLI in an independent fresh workdir",
            "command": " ".join(command),
            "returnCode": completed.returncode,
        }


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


def compare_results(policy: dict[str, Any], *, expected_rows: dict[str, dict[str, str]], computed_rows: dict[str, dict[str, str]]) -> dict[str, Any]:
    tolerances = [float(x) for x in policy["upstreamMetricReproduction"]["tolerancesSeconds"]]
    metrics = list(policy["upstreamMetricReproduction"]["compareMetrics"])
    per_file_f1_tol = float(policy["upstreamMetricReproduction"]["perFileF1Tolerance"])
    aggregate_f1_tol = float(policy["upstreamMetricReproduction"]["aggregateMeanF1Tolerance"])
    f1_deltas_by_tol: dict[str, list[float]] = {str(t): [] for t in tolerances}
    per_row = []
    for base, expected in expected_rows.items():
        computed = computed_rows[base]
        deltas = {}
        exp = {}
        comp = {}
        for tolerance in tolerances:
            for metric in metrics:
                key = f"{metric}-{tolerance}"
                exp[key] = float(expected[key])
                comp[key] = float(computed[key])
                deltas[key] = abs(exp[key] - comp[key])
                if metric == "note-on-f":
                    f1_deltas_by_tol[str(tolerance)].append(deltas[key])
        per_row.append({
            "file": base,
            "expected": exp,
            "computed": comp,
            "absoluteDelta": deltas,
            "perFileF1Pass": all(deltas[f"note-on-f-{t}"] <= per_file_f1_tol for t in tolerances),
        })
    aggregate = {}
    aggregate_pass = True
    for tol, values in f1_deltas_by_tol.items():
        mean = sum(values) / len(values)
        max_delta = max(values)
        aggregate[tol] = {"meanAbsoluteF1Delta": mean, "maxAbsoluteF1Delta": max_delta, "pass": mean <= aggregate_f1_tol}
        aggregate_pass = aggregate_pass and aggregate[tol]["pass"]
    return {
        "pass": all(row["perFileF1Pass"] for row in per_row) and aggregate_pass,
        "perRow": per_row,
        "aggregate": aggregate,
    }


def compare_rows_exact(policy: dict[str, Any], *, expected_rows: dict[str, dict[str, str]], computed_rows: dict[str, dict[str, str]]) -> dict[str, Any]:
    tolerances = [float(x) for x in policy["upstreamMetricReproduction"]["tolerancesSeconds"]]
    metrics = list(policy["upstreamMetricReproduction"]["compareMetrics"])
    max_delta = 0.0
    rows = []
    for base, expected in expected_rows.items():
        computed = computed_rows[base]
        deltas = {}
        for tolerance in tolerances:
            for metric in metrics:
                key = f"{metric}-{tolerance}"
                delta = abs(float(expected[key]) - float(computed[key]))
                deltas[key] = delta
                max_delta = max(max_delta, delta)
        rows.append({"file": base, "maxDelta": max(deltas.values()), "deltas": deltas})
    return {"pass": max_delta <= 1e-9, "maxDelta": max_delta, "rows": rows}


def summarize_sources(cohort: dict[str, Any]) -> list[dict[str, Any]]:
    return [{
        "basename": base,
        "split": src["metadata"].get("split"),
        "year": src["metadata"].get("year"),
        "audioFilename": src["metadata"].get("audio_filename"),
        "midiFilename": src["metadata"].get("midi_filename"),
        "duration": src["metadata"].get("duration"),
        "asset": src["asset"],
        "officialMetadataIdentityVerified": src["metadata"].get("split") == "test",
        "officialArchiveShaVerified": False,
    } for base, src in cohort["sources"].items()]


def exact_environment(args: argparse.Namespace) -> dict[str, Any]:
    code = "import json,sys;mods=['torch','torchaudio','librosa','numpy','scipy','mir_eval','pretty_midi','soxr'];d={'python':sys.version.split()[0]};\nfor m in mods:\n import importlib; mod=importlib.import_module(m); d[m]=getattr(mod,'__version__','unknown')\nimport torch; d['cuda']=getattr(torch.version,'cuda',None); d['cudaAvailable']=torch.cuda.is_available(); d['device']=torch.cuda.get_device_name(0) if torch.cuda.is_available() else 'cpu'; print(json.dumps(d))"
    try:
        return json.loads(subprocess.check_output([sys.executable, "-c", code], text=True))
    except Exception as exc:
        return {"error": repr(exc), "python": sys.version.split()[0]}


def write_decision(args: argparse.Namespace, decision: dict[str, Any], verdict: str, category: str, reason: str) -> int:
    decision["final"] = {
        "development": "NOT RUN",
        "calibration": "NOT RUN",
        "stepReplay": "NOT RUN",
        "continuousReplay": "NOT RUN",
        "browser": "NOT RUN",
        "verdict": f"RTT Shared Streaming Onset Frontend = {verdict}",
        "failureCategory": category,
        "reason": reason,
        "productionMicrophone": "DISABLED",
    }
    write_json(args.decision_json, decision)
    args.decision_md.write_text(markdown(decision), encoding="utf-8")
    return 1 if verdict == "FAIL" else 0


def markdown(decision: dict[str, Any]) -> str:
    final = decision["final"]
    upstream = decision.get("upstreamMetricReproduction", {})
    lines = [
        "# RTT Exact-Upstream Reproduction Decision v4",
        "",
        f"Research harness SHA: `{decision['metadata']['researchHarnessGitHead']}`",
        f"Checkpoint SHA256: `{decision['metadata']['checkpointSha256']}`",
        "",
        "Phase 7: `STRONG NEGATIVE EVIDENCE`",
        "Phase 7B: `INCONCLUSIVE`",
        "Phase 7C: `INCONCLUSIVE`",
        "",
        f"upstream reproduction: `{upstream.get('summary', {}).get('verdict', upstream.get('verdict', 'NOT RUN'))}`",
        f"failure category: `{final['failureCategory']}`",
        f"reason: {final['reason']}",
        "",
        f"```text\n{final['verdict']}\n```",
        "",
        "Production microphone remains disabled after Phase 7D.",
        "No production integration was performed.",
        "",
    ]
    return "\n".join(lines)


def wav_metadata(path: Path) -> dict[str, Any]:
    with wave.open(str(path), "rb") as wav:
        return {
            "sampleRate": wav.getframerate(),
            "channels": wav.getnchannels(),
            "sampleWidthBytes": wav.getsampwidth(),
            "durationSeconds": wav.getnframes() / wav.getframerate(),
        }


def safe_link_or_copy(source: Path, dest: Path) -> None:
    if dest.exists():
        dest.unlink()
    try:
        dest.symlink_to(source)
    except OSError:
        shutil.copy2(source, dest)


def write_json(path: Path, data: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


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
