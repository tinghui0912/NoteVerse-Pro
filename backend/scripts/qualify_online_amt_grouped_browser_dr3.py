#!/usr/bin/env python3
"""DR3R container-only grouped Online-AMT qualification.

This script is deliberately fail-closed on host execution. It must run inside a
Linux Docker container with the repository mounted at /workspace (or another
Linux path). It owns grouped export/parity/manifest/browser orchestration and
does not delegate to the DR2 main program.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import platform
import subprocess
import sys
from pathlib import Path
from typing import Any


REPORT_DATE = "2026-10-13"
REPORT_NAME = f"phase9g_dr3r_container_only_real_grouped_execution_repair_{REPORT_DATE}.json"


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo-root", type=Path, default=Path("/workspace"))
    parser.add_argument("--work-dir", type=Path, default=Path("backend/data/work/phase9g_dr3r_online_amt_grouped"))
    parser.add_argument("--reports-dir", type=Path, default=Path("backend/research/reports"))
    parser.add_argument("--ort-dir", type=Path, default=Path("backend/data/work/phase9gdr3r_ort_130/node_modules/onnxruntime-web/dist"))
    parser.add_argument("--headed", action="store_true")
    args = parser.parse_args()

    repo_root = args.repo_root.resolve()
    reports_dir = (repo_root / args.reports_dir).resolve()
    work_dir = (repo_root / args.work_dir).resolve()
    graphs_dir = work_dir / "graphs"
    fixtures_dir = work_dir / "fixtures"
    for directory in [reports_dir, work_dir, graphs_dir, fixtures_dir]:
        directory.mkdir(parents=True, exist_ok=True)

    attempted: list[dict[str, Any]] = []
    runtime = container_runtime_identity(repo_root)
    implementation_head = git(repo_root, ["rev-parse", "HEAD"])
    remote_head = git(repo_root, ["rev-parse", "origin/codex/customer-web-delivery-boundary"])
    clean = git(repo_root, ["status", "--short"]) == ""

    if not runtime["insideContainer"] or runtime["platformSystem"] == "Windows" or has_drive_letter(runtime["pythonExecutable"]):
        report = base_report(repo_root, runtime, implementation_head, remote_head, clean, attempted)
        report["onlineAmtClosureDecision"] = "HOST_RUNTIME_FORBIDDEN_FOR_DR3R"
        report["blocker"] = {"status": "FAILED", "reason": "HOST_RUNTIME_FORBIDDEN_FOR_DR3R"}
        write_report(reports_dir, report)
        return 2

    try:
        import numpy as np
        import onnxruntime as ort
        import torch
    except ModuleNotFoundError as exc:
        report = base_report(repo_root, runtime, implementation_head, remote_head, clean, attempted)
        report["onlineAmtClosureDecision"] = "ONLINE_AMT_GROUPED_RUNTIME_BLOCKED"
        report["blocker"] = {"status": "FAILED", "reason": "PYTHON_SCIENTIFIC_DEPENDENCY_MISSING", "missingModule": exc.name}
        write_report(reports_dir, report)
        return 2

    sys.path.insert(0, str((repo_root / "backend/scripts").resolve()))
    sys.path.insert(0, str((repo_root / "backend/research").resolve()))
    import qualify_online_amt_browser_stateful as d2  # noqa: E402
    import qualify_online_amt_browser_stateful_d2r1 as d2r1  # noqa: E402
    import qualify_online_amt_grouped_browser_dr2 as dr2  # noqa: E402
    from online_amt_grouped_manifest_dr3 import GroupedGraphIdentity, build_grouped_browser_manifest  # noqa: E402

    source_identity = d2.verify_source_identity(
        repo_root,
        repo_root / "backend/data/work/online_amt",
        repo_root / "backend/data/work/online_amt/model-180000.pt",
        repo_root / "backend/research/product_benchmark/product_benchmark_config.json",
    )
    if source_identity.get("qualificationStatus") != "PASS":
        report = base_report(repo_root, runtime, implementation_head, remote_head, clean, attempted)
        report["onlineAmtClosureDecision"] = "ONLINE_AMT_GROUPED_RUNTIME_BLOCKED"
        report["blocker"] = {"status": "FAILED", "reason": "ONLINE_AMT_SOURCE_IDENTITY_BLOCKED", "sourceIdentity": source_identity}
        write_report(reports_dir, report)
        return 2

    d2.prepare_online_amt_imports(repo_root / "backend/data/work/online_amt")
    from transcribe import OnlineTranscriber, load_model

    model = load_model(str(repo_root / "backend/data/work/online_amt/model-180000.pt"))
    model.eval()
    pcm = d2.load_nonblind_fixture(repo_root, d2r1.TOTAL_HOPS)
    reference = d2r1.generate_reference(model, OnlineTranscriber, pcm, fixtures_dir)

    graph_results: dict[str, Any] = {}
    pytorch_parity: dict[str, Any] = {}
    ort_parity: dict[str, Any] = {}
    manifest_graphs: dict[int, GroupedGraphIdentity] = {}
    for k in [1, 2, 4, 8]:
        graph = dr2.export_grouped_graph(model, reference, graphs_dir, fixtures_dir, k)
        graph_results[str(k)] = graph
        if graph.get("status") != "PASS":
            continue
        manifest_graphs[k] = GroupedGraphIdentity(
            k=k,
            file=Path(graph["path"]).name,
            sha256=graph["sha256"],
            byte_size=graph["bytes"],
        )
        pytorch_parity[str(k)] = dr2.compare_grouped_pytorch(model, OnlineTranscriber, pcm, reference, k)
        ort_parity[str(k)] = run_grouped_python_ort(ort, graph, pcm, reference, k)

    manifest_status: dict[str, Any]
    if set(manifest_graphs) == {1, 2, 4, 8}:
        manifest = build_grouped_browser_manifest(
            graphs=manifest_graphs,
            k1_fallback=manifest_graphs[1],
            hop_fixture="hops.npy",
            initial_state={
                "audioBuffer": "initial_audio_buffer.npy",
                "melBuffer": "initial_mel_buffer.npy",
                "cache0": "initial_cache0.npy",
                "cache1": "initial_cache1.npy",
                "h": "initial_h.npy",
                "c": "initial_c.npy",
                "prevOutput": "initial_prev.npy",
            },
            reference={
                "probabilities": "reference_probabilities.npy",
                "chosenStates": "reference_chosen_states.npy",
                "h": "reference_h.npy",
                "c": "reference_c.npy",
                "melBuffer": "reference_mel_buffer.npy",
                "cache0": "reference_cache0.npy",
                "cache1": "reference_cache1.npy",
            },
            checkpoint_sha256=d2.EXPECTED_CHECKPOINT_SHA256,
            ort_version=ort.__version__,
        )
        (fixtures_dir / "grouped_manifest_dr3r.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        manifest_status = {"status": "PASS", "path": rel(repo_root, fixtures_dir / "grouped_manifest_dr3r.json")}
    else:
        manifest_status = {"status": "NOT_CREATED_GRAPH_EXPORT_INCOMPLETE"}

    browser = run_browser_matrix(repo_root, fixtures_dir, repo_root / args.ort_dir, attempted, args.headed) if manifest_status["status"] == "PASS" else {
        "status": "NOT_EXECUTED_MANIFEST_UNAVAILABLE",
    }
    decision = decide(ort_parity, browser)
    report = base_report(repo_root, runtime, implementation_head, remote_head, clean, attempted)
    report.update({
        "onlineAmtClosureDecision": decision,
        "sourceIdentity": source_identity,
        "containerRuntimeIdentity": runtime,
        "pythonGroupedGraphIdentity": graph_results,
        "pythonOrtSemanticParity": ort_parity,
        "pytorchGroupedParity": pytorch_parity,
        "groupedManifest": manifest_status,
        "syntheticQueueInstrumentationProof": browser.get("overloadProof") if isinstance(browser, dict) else None,
        "realGroupedBrowserRuntime": browser,
        "nativeGateParity": "NOT_EXECUTED_BROWSER_BLOCKED" if browser.get("status", "").startswith("NOT_") else "SEE_BROWSER_RESULT",
        "publicationParity": "NOT_EXECUTED_BROWSER_BLOCKED" if browser.get("status", "").startswith("NOT_") else "SEE_BROWSER_RESULT",
        "realtimeDecision": decision,
        "pipFreezeSha256": pip_freeze_sha(repo_root),
    })
    write_report(reports_dir, report)
    return 0 if decision == "ONLINE_AMT_GROUPED_BROWSER_REALTIME_PASS" else 2


def run_grouped_python_ort(ort: Any, graph: dict[str, Any], pcm: Any, reference: dict[str, Any], k: int) -> dict[str, Any]:
    import numpy as np

    session = ort.InferenceSession(graph["path"], providers=["CPUExecutionProvider"])
    state = {
        "audio": reference["initial"]["audio_buffer"].copy(),
        "mel": reference["initial"]["mel_buffer"].copy(),
        "cache0": reference["initial"]["cache0"].copy(),
        "cache1": reference["initial"]["cache1"].copy(),
        "h": reference["initial"]["h"].copy(),
        "c": reference["initial"]["c"].copy(),
        "prev": reference["initial"]["prev"].copy(),
    }
    chosen_rows = []
    prob_deltas = []
    for group_start in range(0, reference["hopCount"], k):
        if group_start + k > reference["hopCount"]:
            break
        windows = []
        for offset in range(k):
            hop = pcm[(group_start + offset) * 512:(group_start + offset + 1) * 512].astype(np.float32)
            state["audio"] = np.concatenate([state["audio"][:, 512:], hop.reshape(1, 512)], axis=1)
            windows.append(state["audio"][:, -2048:].copy())
        outputs = session.run(None, {
            "audio_last_2048_sequence": np.stack(windows, axis=0).astype(np.float32),
            "mel_buffer_in": state["mel"].astype(np.float32),
            "cache0_in": state["cache0"].astype(np.float32),
            "cache1_in": state["cache1"].astype(np.float32),
            "h_in": state["h"].astype(np.float32),
            "c_in": state["c"].astype(np.float32),
            "prev_output_in": state["prev"].astype(np.int64),
        })
        probabilities, chosen, mel, cache0, cache1, h, c = outputs
        state.update({"mel": mel, "cache0": cache0, "cache1": cache1, "h": h, "c": c, "prev": chosen[-1:]})
        for offset in range(k):
            hop_index = group_start + offset
            chosen_rows.append(chosen[offset].reshape(88))
            prob_deltas.append(compare_np(probabilities[offset].reshape(88, 5), reference["probabilities"][hop_index]))
    chosen_arr = np.asarray(chosen_rows, dtype=np.int64)
    expected = reference["chosen"][: len(chosen_rows)]
    mismatch = np.argwhere(chosen_arr != expected)
    return {
        "status": "PASS" if len(mismatch) == 0 else "FAIL",
        "k": k,
        "hopCount": int(len(chosen_rows)),
        "chosenStateMismatchCount": int(len(mismatch)),
        "probabilityDelta": summarize_deltas(prob_deltas),
        "providers": session.get_providers(),
    }


def run_browser_matrix(repo_root: Path, fixture_dir: Path, ort_dir: Path, attempted: list[dict[str, Any]], headed: bool) -> dict[str, Any]:
    if not (repo_root / "backend/research/browser_runtime/online_amt_grouped_browser_harness_dr3.mjs").exists():
        return {"status": "NOT_EXECUTED_HARNESS_MISSING"}
    node = shutil_which("node")
    if node is None:
        return {"status": "ONLINE_AMT_GROUPED_RUNTIME_BLOCKED_CONTAINER_BROWSER_NODE_MISSING"}
    result: dict[str, Any] = {"status": "ATTEMPTED", "runs": {}}
    overload_cmd = [
        node,
        "backend/research/browser_runtime/online_amt_grouped_browser_harness_dr3.mjs",
        "--fixture-dir", str(fixture_dir),
        "--ort-dir", str(ort_dir),
        "--mode", "overload-proof",
        "--k", "1",
        "--artificial-delay-ms", "80",
    ]
    if headed:
        overload_cmd.append("--headed")
    result["overloadProof"] = run_command(overload_cmd, repo_root, attempted, 180)
    for browser in ["chrome", "msedge"]:
        for k in [1, 2, 4, 8]:
            cmd = [
                node,
                "backend/research/browser_runtime/online_amt_grouped_browser_harness_dr3.mjs",
                "--fixture-dir", str(fixture_dir),
                "--ort-dir", str(ort_dir),
                "--mode", "model",
                "--browser-channel", browser,
                "--k", str(k),
            ]
            if headed:
                cmd.append("--headed")
            result["runs"][f"{browser}:k{k}"] = run_command(cmd, repo_root, attempted, 240)
    return result


def decide(ort_parity: dict[str, Any], browser: dict[str, Any]) -> str:
    if not any(row.get("status") == "PASS" and row.get("chosenStateMismatchCount") == 0 for row in ort_parity.values()):
        return "ONLINE_AMT_GROUPED_SEMANTIC_PARITY_FAILED"
    if browser.get("status", "").startswith("ONLINE_AMT_GROUPED_RUNTIME_BLOCKED") or browser.get("status", "").startswith("NOT_"):
        return "ONLINE_AMT_GROUPED_RUNTIME_BLOCKED_CONTAINER_BROWSER_WEBGPU"
    return "ONLINE_AMT_GROUPED_RUNTIME_BLOCKED_CONTAINER_BROWSER_WEBGPU"


def container_runtime_identity(repo_root: Path) -> dict[str, Any]:
    cgroup = Path("/proc/1/cgroup")
    cgroup_text = cgroup.read_text(encoding="utf-8", errors="ignore") if cgroup.exists() else ""
    inside = Path("/.dockerenv").exists() or "docker" in cgroup_text or "containerd" in cgroup_text
    return {
        "insideContainer": inside,
        "dockerenv": Path("/.dockerenv").exists(),
        "cgroupEvidence": cgroup_text[:500],
        "platformSystem": platform.system(),
        "platformRelease": platform.release(),
        "pythonVersion": platform.python_version(),
        "pythonExecutable": sys.executable,
        "workingDirectory": str(Path.cwd()),
        "dockerfileOnlineAmtModernSha256": sha256_file(repo_root / "docker/research/Dockerfile.online-amt-modern"),
        "requirementsOnlineAmtModernSha256": sha256_file(repo_root / "docker/research/requirements.online-amt-modern.txt"),
        "requirementsDr3rSha256": sha256_file(repo_root / "docker/research/requirements.online-amt-dr3r.txt"),
    }


def base_report(repo_root: Path, runtime: dict[str, Any], implementation_head: str, remote_head: str, clean: bool, attempted: list[dict[str, Any]]) -> dict[str, Any]:
    return {
        "phase": "PHASE_9G_DR3R_CONTAINER_ONLY_REAL_GROUPED_EXECUTION_REPAIR",
        "implementationGitHead": implementation_head,
        "implementationWorkingTreeCleanBeforeExecution": clean,
        "verifiedStartingRemoteHead": remote_head,
        "containerRuntimeIdentity": runtime,
        "attemptedCommands": attempted,
        "criticalImplementationFileSha256": critical_hashes(repo_root),
        "scopeProtections": {
            "p15p22InferenceIncrease": 0,
            "phase9gBOutcome": "STATISTICAL_TIE",
            "phase9gBWinner": None,
            "productionMicrophoneEnabled": False,
            "practiceWebSocketRestored": False,
            "backendPracticeInferenceRestored": False,
            "productionWinnerSelected": False,
            "d4QualificationPerformed": False,
        },
        "p15p22InferenceIncrease": 0,
        "productionMicrophoneEnabled": False,
        "productionWinnerSelected": False,
        "historicalPhase9gBConclusion": {"outcome": "STATISTICAL_TIE", "winner": None},
    }


def critical_hashes(repo_root: Path) -> dict[str, str]:
    paths = [
        "backend/scripts/qualify_online_amt_grouped_browser_dr3.py",
        "backend/research/browser_runtime/online_amt_grouped_browser_harness_dr3.mjs",
        "backend/research/browser_runtime/online_amt_grouped_browser_worker_dr3.mjs",
        "backend/research/online_amt_grouped_manifest_dr3.py",
    ]
    return {path: sha256_file(repo_root / path) for path in paths}


def compare_np(left: Any, right: Any) -> dict[str, float]:
    import numpy as np
    delta = np.abs(left.astype(np.float64) - right.astype(np.float64))
    return {"meanAbsDelta": float(delta.mean()), "p95AbsDelta": float(np.percentile(delta, 95)), "maxAbsDelta": float(delta.max())}


def summarize_deltas(rows: list[dict[str, float]]) -> dict[str, float | None]:
    if not rows:
        return {"meanAbsDeltaMax": None, "p95AbsDeltaMax": None, "maxAbsDelta": None}
    return {
        "meanAbsDeltaMax": max(row["meanAbsDelta"] for row in rows),
        "p95AbsDeltaMax": max(row["p95AbsDelta"] for row in rows),
        "maxAbsDelta": max(row["maxAbsDelta"] for row in rows),
    }


def run_command(cmd: list[str], cwd: Path, attempted: list[dict[str, Any]], timeout: int) -> dict[str, Any]:
    completed = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True, timeout=timeout, check=False)
    row = {"command": cmd, "exitCode": completed.returncode, "stdoutTail": completed.stdout[-4000:], "stderrTail": completed.stderr[-4000:]}
    attempted.append(row)
    return row


def pip_freeze_sha(repo_root: Path) -> str:
    completed = subprocess.run([sys.executable, "-m", "pip", "freeze"], cwd=repo_root, text=True, capture_output=True, check=False)
    return hashlib.sha256(completed.stdout.encode("utf-8")).hexdigest()


def rel(repo_root: Path, path: Path) -> str:
    return path.resolve().relative_to(repo_root.resolve()).as_posix()


def has_drive_letter(path: str) -> bool:
    return len(path) >= 2 and path[1] == ":"


def shutil_which(command: str) -> str | None:
    for directory in os.environ.get("PATH", "").split(os.pathsep):
        candidate = Path(directory) / command
        if candidate.exists():
            return str(candidate)
    return None


def write_report(reports_dir: Path, report: dict[str, Any]) -> None:
    (reports_dir / REPORT_NAME).write_text(json.dumps(report, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def git(repo_root: Path, args: list[str]) -> str:
    return subprocess.check_output(["git", *args], cwd=repo_root, text=True).strip()


if __name__ == "__main__":
    raise SystemExit(main())
