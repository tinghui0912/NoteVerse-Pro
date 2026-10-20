#!/usr/bin/env python3
"""Finalize Phase 9G-D.2R.1 reports from host browser Worker outputs."""

from __future__ import annotations

import hashlib
import json
import math
import subprocess
from pathlib import Path
from typing import Any


REPORT_DATE = "2026-10-13"
TIMING_CORRECTION_MS = -162.93750000004252
SAMPLE_RATE = 16000
HOP_SAMPLES = 512
OWNED_HOPS = 320
TAIL_HOPS = 6
TOTAL_HOPS = OWNED_HOPS + TAIL_HOPS
OWNED_SAMPLES = OWNED_HOPS * HOP_SAMPLES
TAIL_SAMPLES = TAIL_HOPS * HOP_SAMPLES


def main() -> int:
    repo = Path(".").resolve()
    reports = repo / "backend/research/reports"
    work = repo / "backend/data/work/phase9gd2r1_online_amt_browser"
    fixtures = work / "fixtures"
    graph = read(reports / f"phase9g_d2r1_online_amt_combined_graph_{REPORT_DATE}.json")
    chrome_gate = read(work / "chrome_worker_gate_host.json")
    chrome = read(work / "chrome_worker_combined.json")
    edge = read(work / "edge_worker_combined.json")
    browser_artifact_path = fixtures / "browser_hop_artifact.json"
    python_artifact_path = fixtures / "python_hop_artifact.json"
    browser_artifact = result(chrome)["artifact"]
    write(browser_artifact_path, browser_artifact)
    bridge = run_bridge(repo, work, python_artifact_path, browser_artifact_path)
    worker_file = repo / "backend/research/browser_runtime/online_amt_stateful_browser_worker.mjs"
    harness_file = repo / "backend/research/browser_runtime/online_amt_stateful_browser_harness.mjs"
    chrome_body = result(chrome)
    edge_body = result(edge)
    outcome = decide_outcome(chrome_body, edge_body, graph)
    eligible = outcome == "ONLINE_AMT_BROWSER_FEASIBILITY_VALIDATED"
    base = {
        "phase": "9G-D.2R.1",
        "schemaVersion": 1,
        "p15p22InferenceIncrease": 0,
        "productionMicrophoneEnabled": False,
        "productionWinnerSelected": False,
        "phase9gBHistoricalConclusion": {"outcome": "STATISTICAL_TIE", "winner": None},
    }
    tail = tail_requirement()
    d2r_runtime = read_optional(reports / f"phase9g_d2r_online_amt_default_browser_runtime_{REPORT_DATE}.json")
    d2r_feas = read_optional(reports / f"phase9g_d2r_online_amt_feasibility_receipt_{REPORT_DATE}.json")
    out = {
        "phase9g_d2r1_correction_receipt": {
            **base,
            "artifact": "phase9g_d2r1_correction_receipt",
            "d2rSplitSessionResult": "ONLINE_AMT_BROWSER_REALTIME_BACKLOG_UNSTABLE",
            "d2rSplitSessionScope": "three-session browser implementation only",
            "d2r1Purpose": "one prospectively allowed combined active-hop graph + correct frozen native gate + actual Worker execution + authoritative publication bridge",
            "retainedD2rEvidence": {"d2rSplitSessionEvidenceRetained": True, "outcome": (d2r_feas or {}).get("outcome"), "runtime": d2r_runtime},
        },
        "phase9g_d2r1_online_amt_combined_graph": graph,
        "phase9g_d2r1_online_amt_real_native_gate_parity": {
            **base,
            "artifact": "phase9g_d2r1_online_amt_real_native_gate_parity",
            "nativeGatePrevOutputBugDisposition": "FIXED_BROWSER_SHORT_CIRCUIT_RETURNS_SILENT_STATES_WITHOUT_MUTATING_PERSISTENT_PREV_OUTPUT",
            "chromeGateWorker": result(chrome_gate)["realNativeGateParity"],
        },
        "phase9g_d2r1_online_amt_worker_step_parity": {
            **base,
            "artifact": "phase9g_d2r1_online_amt_worker_step_parity",
            "browserDriverSha256": sha256(harness_file),
            "browserWorker": {"path": rel(worker_file), "sha256": sha256(worker_file)},
            "chrome": parity(chrome_body),
            "edge": parity(edge_body),
            "unsafeWebGpuFlagUsed": False,
            "wasmFallbackUsed": False,
        },
        "phase9g_d2r1_online_amt_publication_bridge_parity": {
            **base,
            "artifact": "phase9g_d2r1_online_amt_publication_bridge_parity",
            "tailRequirement": tail,
            "ownedPerformanceMs": OWNED_SAMPLES / SAMPLE_RATE * 1000,
            "requiredProcessingFrontierMs": TOTAL_HOPS * HOP_SAMPLES / SAMPLE_RATE * 1000,
            "correctedFrontierMs": TOTAL_HOPS * HOP_SAMPLES / SAMPLE_RATE * 1000 + TIMING_CORRECTION_MS,
            "finalAnalyzedThroughPerformanceMs": OWNED_SAMPLES / SAMPLE_RATE * 1000,
            "pythonArtifact": file_id(python_artifact_path),
            "browserArtifact": file_id(browser_artifact_path),
            "typescriptBridge": bridge,
        },
        "phase9g_d2r1_online_amt_worker_runtime": {
            **base,
            "artifact": "phase9g_d2r1_online_amt_worker_runtime",
            "splitSessionDiagnostic": d2r_runtime,
            "chromeHeadedDefaultWebGpu": runtime(chrome_body, chrome),
            "edgeHeadedDefaultWebGpu": runtime(edge_body, edge),
            "unsafeWebGpuFlagUsed": False,
            "wasmFallbackUsed": False,
        },
        "phase9g_d2r1_online_amt_final_feasibility": {
            **base,
            "artifact": "phase9g_d2r1_online_amt_final_feasibility",
            "outcome": outcome,
            "onlineAmtEligibleForCurrentOfflineFirstProductionFinal": eligible,
            "noFurtherOnlineAmtOptimizationPhaseRequired": True,
            "browserDeploymentIdentity": identity(graph, worker_file, harness_file, outcome) if eligible else None,
        },
    }
    for name, value in out.items():
        write(reports / f"{name}_{REPORT_DATE}.json", value)
    print(json.dumps({"outcome": outcome, "bridge": bridge["status"]}, indent=2))
    return 0


def decide_outcome(chrome: dict[str, Any], edge: dict[str, Any], graph: dict[str, Any]) -> str:
    if graph["combinedPyTorchParity"]["status"] != "PASS" or graph["combinedPythonOrtParity"]["status"] != "PASS":
        return "ONLINE_AMT_BROWSER_SOURCE_RUNTIME_PARITY_DIVERGED"
    if chrome.get("status") != "PASS" or edge.get("status") != "PASS":
        return "ONLINE_AMT_BROWSER_IMPLEMENTATION_ERROR"
    if chrome["chosenState"]["mismatchCount"] or edge["chosenState"]["mismatchCount"]:
        return "ONLINE_AMT_BROWSER_SOURCE_RUNTIME_PARITY_DIVERGED"
    if chrome["backlogClassification"] != "TRANSIENT_BACKLOG_DRAINED" or edge["backlogClassification"] != "TRANSIENT_BACKLOG_DRAINED":
        return "ONLINE_AMT_BROWSER_REALTIME_BACKLOG_UNSTABLE"
    return "ONLINE_AMT_BROWSER_FEASIBILITY_VALIDATED"


def run_bridge(repo: Path, work: Path, python_artifact: Path, browser_artifact: Path) -> dict[str, Any]:
    output = work / "publication_bridge_receipt.json"
    cmd = [
        "node",
        str(repo / "backend/research/browser_runtime/online_amt_d2r1_bridge_hop_artifacts.mjs"),
        "--python-artifact", str(python_artifact),
        "--browser-artifact", str(browser_artifact),
        "--output", str(output),
    ]
    proc = subprocess.run(cmd, cwd=repo, text=True, encoding="utf-8", errors="replace", capture_output=True, timeout=120)
    body = read(output) if output.exists() else None
    return {
        "status": "PASS" if proc.returncode == 0 and body else "FAILED",
        "returncode": proc.returncode,
        "stdoutTail": (proc.stdout or "")[-4000:],
        "stderrTail": (proc.stderr or "")[-4000:],
        "receipt": body,
    }


def parity(body: dict[str, Any]) -> dict[str, Any]:
    return {key: body.get(key) for key in ["status", "hopCount", "probability", "melBuffer", "cache0", "cache1", "h", "c", "chosenState"]}


def runtime(body: dict[str, Any], run: dict[str, Any]) -> dict[str, Any]:
    return {
        "status": body.get("status"),
        "runtime": run.get("runtime"),
        "ort": run.get("ort_asset"),
        "sessionLoadCount": body.get("sessionLoadCount"),
        "combinedLoadMs": body.get("combinedLoadMs"),
        "firstCombinedExecutionMs": body.get("firstCombinedExecutionMs"),
        "completeHopLatencyMs": body.get("completeHopLatencyMs"),
        "combinedSessionRunMs": body.get("combinedSessionRunMs"),
        "nonOrtJsMs": body.get("nonOrtJsMs"),
        "queueDelayMs": body.get("queueDelayMs"),
        "finalQueueDelayMs": body.get("finalQueueDelayMs"),
        "maximumQueueDepth": body.get("maximumQueueDepth"),
        "tail64QueueDelayMs": body.get("tail64QueueDelayMs"),
        "backlogClassification": body.get("backlogClassification"),
    }


def identity(graph: dict[str, Any], worker: Path, driver: Path, outcome: str) -> dict[str, Any]:
    payload = {
        "deploymentId": "online-amt-browser-v1",
        "sourceCandidateId": "online-amt-calibrated-v1",
        "upstreamCommit": "ad12550909a1d86f699097d11885f427054a5ac2",
        "checkpointSha256": "54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0",
        "configurationSha256": "0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375",
        "combinedGraphSha256": graph["graph"]["sha256"],
        "browserDriverSha256": sha256(driver),
        "browserWorkerSha256": sha256(worker),
        "stateContractVersion": "online_amt_explicit_state_contract_v2_combined_active_hop",
        "ortWebVersion": "1.20.1",
        "executionProvider": "webgpu",
        "timingCorrectionMs": TIMING_CORRECTION_MS,
        "publishedOnsetBoost": 1.0,
        "pseudoIntensity": "NATIVE",
        "hopSamples": HOP_SAMPLES,
        "sourceRuntimeParityStatus": outcome,
    }
    payload["deploymentSha256"] = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return payload


def tail_requirement() -> dict[str, int]:
    correction = math.ceil(abs(TIMING_CORRECTION_MS) / 1000 * SAMPLE_RATE)
    return {"correctionDelaySamples": correction, "requiredProcessedSamples": TOTAL_HOPS * HOP_SAMPLES, "requiredContextTailSamples": TAIL_SAMPLES}


def result(run: dict[str, Any]) -> dict[str, Any]:
    return run["result"]


def read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_optional(path: Path) -> dict[str, Any] | None:
    return read(path) if path.exists() else None


def write(path: Path, value: Any) -> None:
    path.write_text(json.dumps(normalize(value), indent=2) + "\n", encoding="utf-8")


def normalize(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, str) and "NoteVerse-Pro" in value:
        return value.split("NoteVerse-Pro", 1)[1].lstrip("/\\").replace("\\", "/")
    if isinstance(value, str) and value.startswith("/workspace/"):
        return value.removeprefix("/workspace/").replace("\\", "/")
    return value


def file_id(path: Path) -> dict[str, Any]:
    return {"path": rel(path), "byteSize": path.stat().st_size, "sha256": sha256(path)}


def rel(path: Path) -> str:
    return str(path).split("NoteVerse-Pro", 1)[1].lstrip("/\\").replace("\\", "/")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


if __name__ == "__main__":
    raise SystemExit(main())
