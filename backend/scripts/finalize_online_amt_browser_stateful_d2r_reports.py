#!/usr/bin/env python3
"""Finalize D.2R reports with host browser harness results."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


REPORT_DATE = "2026-10-13"
TIMING_CORRECTION_MS = -162.93750000004252
SAMPLE_RATE = 16000
HOP_SAMPLES = 512


def main() -> int:
    repo = Path(".").resolve()
    reports = repo / "backend/research/reports"
    work = repo / "backend/data/work/phase9gd2r_online_amt_browser"
    graph = read(reports / f"phase9g_d2r_online_amt_graph_export_{REPORT_DATE}.json")
    correction = read(reports / f"phase9g_d2r_correction_receipt_{REPORT_DATE}.json")
    chrome_native = read_optional(work / "chrome_native_lm_host.json")
    chrome = read_optional(work / "chrome_pipeline_native_host.json")
    edge = read_optional(work / "edge_pipeline_native_host.json")
    chrome_gate = read_optional(work / "chrome_native_gate_host.json")
    bridge = bridge_report(chrome)
    layer = {
        "schemaVersion": 1,
        "artifact": "phase9g_d2r_online_amt_browser_layer_parity",
        "phase": "9G-D.2R",
        "pythonToPythonExportable": graph["pythonExportableParity"],
        "pythonToChrome": layer_extract(chrome),
        "pythonToEdge": layer_extract(edge),
        "p15p22InferenceIncrease": 0,
    }
    step = {
        "schemaVersion": 1,
        "artifact": "phase9g_d2r_online_amt_browser_step_parity",
        "phase": "9G-D.2R",
        "hopCount": 320,
        "totalPitchHopComparisons": 320 * 88,
        "nativeLmWebGpuAttempt": native_extract(chrome_native),
        "manualFloatLstmNeeded": False if ok(chrome_native) else True,
        "manualFloatGraphExportedForFallbackDiagnosis": graph["graphs"]["lmFloat"],
        "chrome": step_extract(chrome),
        "edge": step_extract(edge),
        "nativeGateBrowserParity": gate_extract(chrome_gate, chrome),
        "unsafeWebGpuFlagUsed": False,
        "wasmFallbackUsed": False,
        "p15p22InferenceIncrease": 0,
    }
    runtime = {
        "schemaVersion": 1,
        "artifact": "phase9g_d2r_online_amt_default_browser_runtime",
        "phase": "9G-D.2R",
        "chromeDefaultWebGpu": runtime_extract(chrome),
        "edgeDefaultWebGpu": runtime_extract(edge),
        "unsafeWebGpuFlagUsed": False,
        "wasmFallbackUsed": False,
        "memoryTelemetry": {"status": "NOT_MEASURED", "reason": "browser API did not expose trustworthy process memory for this research harness"},
        "vramTelemetry": {"status": "NOT_MEASURED", "reason": "WebGPU adapter does not expose trustworthy VRAM utilization"},
        "networkTelemetry": {"status": "NOT_MEASURED", "reason": "local static harness; no production network transport"},
        "p15p22InferenceIncrease": 0,
    }
    feasibility_outcome = outcome(chrome, edge)
    feasibility = {
        "schemaVersion": 1,
        "artifact": "phase9g_d2r_online_amt_feasibility_receipt",
        "phase": "9G-D.2R",
        "outcome": feasibility_outcome,
        "chromeStatus": status(chrome),
        "edgeStatus": status(edge),
        "nativeLmWebGpuExecuted": ok(chrome_native),
        "browserDeploymentIdentity": browser_identity(graph, feasibility_outcome),
        "publicationBridgeStatus": bridge["status"],
        "productionMicrophoneEnabled": False,
        "productionWinnerSelected": False,
        "phase9gBHistoricalConclusion": {"outcome": "STATISTICAL_TIE", "winner": None},
        "p15p22InferenceIncrease": 0,
    }
    write(reports / f"phase9g_d2r_correction_receipt_{REPORT_DATE}.json", correction)
    write(reports / f"phase9g_d2r_online_amt_browser_layer_parity_{REPORT_DATE}.json", layer)
    write(reports / f"phase9g_d2r_online_amt_browser_step_parity_{REPORT_DATE}.json", step)
    write(reports / f"phase9g_d2r_online_amt_publication_bridge_parity_{REPORT_DATE}.json", bridge)
    write(reports / f"phase9g_d2r_online_amt_default_browser_runtime_{REPORT_DATE}.json", runtime)
    write(reports / f"phase9g_d2r_online_amt_feasibility_receipt_{REPORT_DATE}.json", feasibility)
    print(json.dumps({"outcome": feasibility_outcome, "chrome": status(chrome), "edge": status(edge)}, indent=2))
    return 0


def read(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def read_optional(path: Path) -> dict[str, Any] | None:
    return read(path) if path.exists() else None


def ok(run: dict[str, Any] | None) -> bool:
    return bool(run and run.get("error") is None and run.get("result", {}).get("status") == "PASS")


def status(run: dict[str, Any] | None) -> str:
    if ok(run):
        return "PASS"
    if not run:
        return "NOT_EXECUTED"
    return "FAILED"


def result(run: dict[str, Any] | None) -> dict[str, Any] | None:
    return None if not run else run.get("result")


def layer_extract(run: dict[str, Any] | None) -> dict[str, Any]:
    body = result(run) or {}
    return {
        "status": status(run),
        "error": None if ok(run) else (run or {}).get("error"),
        "mel": body.get("mel"),
        "cache0": "STATEFUL_CACHE_UPDATED_IN_BROWSER_NOT_DUMPED",
        "cache1": "STATEFUL_CACHE_UPDATED_IN_BROWSER_NOT_DUMPED",
        "acousticOut": body.get("acousticOut"),
        "h": body.get("h"),
        "c": body.get("c"),
        "probabilities": body.get("probabilities"),
        "runtime": (run or {}).get("runtime"),
        "ort": (run or {}).get("ort_asset"),
    }


def step_extract(run: dict[str, Any] | None) -> dict[str, Any]:
    body = result(run) or {}
    return {
        "status": status(run),
        "chosenState": body.get("chosenState"),
        "pipelineLm": body.get("pipelineLm"),
        "webgpuAdapter": body.get("webgpuAdapter"),
    }


def native_extract(run: dict[str, Any] | None) -> dict[str, Any]:
    body = result(run) or {}
    return {
        "status": status(run),
        "error": None if ok(run) else (run or {}).get("error"),
        "probabilities": body.get("probabilities"),
        "h": body.get("h"),
        "c": body.get("c"),
        "runtime": (run or {}).get("runtime"),
        "ort": (run or {}).get("ort_asset"),
    }


def gate_extract(gate_run: dict[str, Any] | None, sequence_run: dict[str, Any] | None) -> dict[str, Any]:
    body = result(gate_run) or {}
    return {
        "status": status(gate_run),
        "boundaryFixture": body,
        "activeSequenceRows": (result(sequence_run) or {}).get("nativeGateRows"),
        "comparedAgainstD2PythonBoundary": True,
    }


def runtime_extract(run: dict[str, Any] | None) -> dict[str, Any]:
    body = result(run) or {}
    return {
        "status": status(run),
        "runtime": (run or {}).get("runtime"),
        "ort": (run or {}).get("ort_asset"),
        "sessionLoadCount": body.get("sessionLoadCount"),
        "graphLoadMs": body.get("graphLoadMs"),
        "firstGraphExecutionMs": body.get("firstGraphExecutionMs"),
        "firstCompleteHopMs": body.get("firstCompleteHopMs"),
        "completeHopLatencyMs": body.get("completeHopLatencyMs"),
        "queueDelayMs": body.get("queueDelayMs"),
        "finalQueueDelayMs": body.get("finalQueueDelayMs"),
        "maximumQueueDepth": body.get("maximumQueueDepth"),
        "tailQueueDelayMs": body.get("tailQueueDelayMs"),
        "backlogClassification": body.get("backlogClassification"),
    }


def outcome(chrome: dict[str, Any] | None, edge: dict[str, Any] | None) -> str:
    if not ok(chrome) or not ok(edge):
        return "ONLINE_AMT_BROWSER_IMPLEMENTATION_ERROR"
    chrome_backlog = result(chrome).get("backlogClassification")
    edge_backlog = result(edge).get("backlogClassification")
    if chrome_backlog != "TRANSIENT_BACKLOG_DRAINED" or edge_backlog != "TRANSIENT_BACKLOG_DRAINED":
        return "ONLINE_AMT_BROWSER_REALTIME_BACKLOG_UNSTABLE"
    if result(chrome)["chosenState"]["mismatchCount"] or result(edge)["chosenState"]["mismatchCount"]:
        return "ONLINE_AMT_BROWSER_SOURCE_RUNTIME_PARITY_DIVERGED"
    return "ONLINE_AMT_BROWSER_FEASIBILITY_VALIDATED"


def bridge_report(chrome: dict[str, Any] | None) -> dict[str, Any]:
    req = tail_requirement(320 * 512)
    return {
        "schemaVersion": 1,
        "artifact": "phase9g_d2r_online_amt_publication_bridge_parity",
        "phase": "9G-D.2R",
        "status": "TAIL_AUTHORITY_RECORDED_BROWSER_HOP_ARTIFACT_NOT_BRIDGED",
        "authoritativeTailRequirement": req,
        "ownedPerformanceMs": 10240,
        "requiredProcessingFrontierMs": req["requiredProcessedSamples"] / SAMPLE_RATE * 1000,
        "correctedFrontierMs": req["requiredProcessedSamples"] / SAMPLE_RATE * 1000 + TIMING_CORRECTION_MS,
        "finalOwnedAnalyzedThroughPerformanceMs": 10240,
        "timingCorrectionMs": TIMING_CORRECTION_MS,
        "browserChosenStateParity": (result(chrome) or {}).get("chosenState"),
        "publicationBridgeParity": "NOT_EXECUTED_BROWSER_OUTPUT_NOT_SERIALIZED_AS_AUTHORITATIVE_HOP_ARTIFACT",
        "p15p22InferenceIncrease": 0,
    }


def tail_requirement(samples: int) -> dict[str, int]:
    correction = int(__import__("math").ceil(abs(TIMING_CORRECTION_MS) / 1000 * SAMPLE_RATE))
    required = int(__import__("math").ceil((samples + correction) / HOP_SAMPLES) * HOP_SAMPLES)
    return {"correctionDelaySamples": correction, "requiredProcessedSamples": required, "requiredContextTailSamples": max(0, required - samples)}


def browser_identity(graph: dict[str, Any], parity_status: str) -> dict[str, Any]:
    payload = {
        "deploymentId": "online-amt-browser-v1",
        "sourceCandidateId": "online-amt-calibrated-v1",
        "upstreamCommit": "ad12550909a1d86f699097d11885f427054a5ac2",
        "checkpointSha256": "54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0",
        "configurationSha256": "0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375",
        "melGraphSha256": graph["graphs"]["mel"]["sha256"],
        "acousticGraphSha256": graph["graphs"]["acoustic"]["sha256"],
        "lmGraphSha256": graph["graphs"]["lmNative"]["sha256"],
        "manualFloatLmGraphSha256": graph["graphs"]["lmFloat"]["sha256"],
        "stateContractVersion": "online_amt_explicit_state_contract_v1",
        "browserWorkerImplementationSha256": sha256(Path("backend/research/browser_runtime/online_amt_stateful_browser_harness.mjs")),
        "ortWebVersion": "1.20.1",
        "executionProvider": "webgpu",
        "timingCorrectionMs": TIMING_CORRECTION_MS,
        "publishedOnsetBoost": 1.0,
        "pseudoIntensity": "NATIVE",
        "nativeGatePolicy": "threshold=0.05;patience=100;shortCircuitWhen=num_under_thr>patience",
        "hopSamples": HOP_SAMPLES,
        "sourceRuntimeParityStatus": parity_status,
    }
    payload["deploymentSha256"] = hashlib.sha256(json.dumps(payload, sort_keys=True).encode("utf-8")).hexdigest()
    return payload


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def normalize(value: Any) -> Any:
    if isinstance(value, dict):
        return {key: normalize(item) for key, item in value.items()}
    if isinstance(value, list):
        return [normalize(item) for item in value]
    if isinstance(value, str) and "NoteVerse-Pro" in value:
        return value.split("NoteVerse-Pro", 1)[1].lstrip("/\\").replace("\\", "/")
    return value


def write(path: Path, value: dict[str, Any]) -> None:
    path.write_text(json.dumps(normalize(value), indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    raise SystemExit(main())
