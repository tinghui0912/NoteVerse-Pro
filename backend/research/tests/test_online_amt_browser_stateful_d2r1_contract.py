from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
REPORTS = REPO_ROOT / "backend" / "research" / "reports"
WORKER = REPO_ROOT / "backend" / "research" / "browser_runtime" / "online_amt_stateful_browser_worker.mjs"
HARNESS = REPO_ROOT / "backend" / "research" / "browser_runtime" / "online_amt_stateful_browser_harness.mjs"
BRIDGE = REPO_ROOT / "backend" / "research" / "browser_runtime" / "online_amt_d2r1_bridge_hop_artifacts.mjs"


def read_report(name: str) -> dict:
    path = REPORTS / f"{name}_2026-10-13.json"
    assert path.exists(), f"missing D.2R.1 report: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


def test_d2r1_retains_d2r_split_session_history() -> None:
    report = read_report("phase9g_d2r1_correction_receipt")

    assert report["d2rSplitSessionResult"] == "ONLINE_AMT_BROWSER_REALTIME_BACKLOG_UNSTABLE"
    assert report["d2rSplitSessionScope"] == "three-session browser implementation only"
    assert "combined active-hop graph" in report["d2r1Purpose"]
    assert report["retainedD2rEvidence"]["d2rSplitSessionEvidenceRetained"] is True
    assert report["p15p22InferenceIncrease"] == 0


def test_d2r1_combined_graph_parity_is_executed() -> None:
    report = read_report("phase9g_d2r1_online_amt_combined_graph")
    graph = report["graph"]

    assert graph["status"] == "PASS"
    assert graph["graphKind"] == "combinedActiveHop"
    assert graph["byteSize"] > 70_000_000
    assert "LSTM" in graph["operators"]
    assert "Conv" in graph["operators"]
    assert report["combinedPyTorchParity"]["status"] == "PASS"
    assert report["combinedPyTorchParity"]["chosenStateMismatchCount"] == 0
    assert report["combinedPythonOrtParity"]["status"] == "PASS"
    assert report["combinedPythonOrtParity"]["chosenStateMismatchCount"] == 0


def test_d2r1_real_native_gate_freezes_model_state_and_preserves_prev_output() -> None:
    report = read_report("phase9g_d2r1_online_amt_real_native_gate_parity")
    gate = report["chromeGateWorker"]
    rows = {row["silentHopCount"]: row for row in gate["rows"]}

    assert gate["status"] == "PASS"
    assert rows[99]["shortCircuit"] is False
    assert rows[100]["shortCircuit"] is False
    assert rows[101]["shortCircuit"] is True
    assert rows[102]["shortCircuit"] is True
    for count in [101, 102]:
        row = rows[count]
        assert row["audioChanged"] is True
        assert row["melFrozen"] is True
        assert row["cache0Frozen"] is True
        assert row["cache1Frozen"] is True
        assert row["hFrozen"] is True
        assert row["cFrozen"] is True
        assert row["prevOutputFrozen"] is True
    assert gate["recovery"]["numUnderThrAfterRecovery"] == 0
    assert gate["recovery"]["normalNeuralProgressionResumed"] is True


def test_d2r1_worker_parity_and_runtime_conclude_backlog_unstable() -> None:
    parity = read_report("phase9g_d2r1_online_amt_worker_step_parity")
    runtime = read_report("phase9g_d2r1_online_amt_worker_runtime")
    feasibility = read_report("phase9g_d2r1_online_amt_final_feasibility")

    assert parity["chrome"]["hopCount"] == 326
    assert parity["edge"]["hopCount"] == 326
    assert parity["chrome"]["chosenState"]["totalPitchHopComparisons"] == 326 * 88
    assert parity["chrome"]["chosenState"]["mismatchCount"] == 0
    assert parity["edge"]["chosenState"]["mismatchCount"] == 0
    assert parity["unsafeWebGpuFlagUsed"] is False
    assert parity["wasmFallbackUsed"] is False
    assert runtime["chromeHeadedDefaultWebGpu"]["sessionLoadCount"] == 1
    assert runtime["edgeHeadedDefaultWebGpu"]["sessionLoadCount"] == 1
    assert runtime["chromeHeadedDefaultWebGpu"]["backlogClassification"] == "BACKLOG_PRESENT_OR_GROWING"
    assert runtime["edgeHeadedDefaultWebGpu"]["backlogClassification"] == "BACKLOG_PRESENT_OR_GROWING"
    assert feasibility["outcome"] == "ONLINE_AMT_BROWSER_REALTIME_BACKLOG_UNSTABLE"
    assert feasibility["onlineAmtEligibleForCurrentOfflineFirstProductionFinal"] is False
    assert feasibility["noFurtherOnlineAmtOptimizationPhaseRequired"] is True


def test_d2r1_authoritative_publication_bridge_runs_326_hop_artifacts() -> None:
    report = read_report("phase9g_d2r1_online_amt_publication_bridge_parity")
    receipt = report["typescriptBridge"]["receipt"]

    assert report["tailRequirement"] == {
        "correctionDelaySamples": 2608,
        "requiredProcessedSamples": 166912,
        "requiredContextTailSamples": 3072,
    }
    assert report["finalAnalyzedThroughPerformanceMs"] == 10240
    assert report["typescriptBridge"]["status"] == "PASS"
    assert receipt["python"]["publicationCount"] == 321
    assert receipt["browser"]["publicationCount"] == 321
    assert receipt["python"]["observationCount"] == receipt["browser"]["observationCount"]
    assert receipt["python"]["finalAnalyzedThroughPerformanceMs"] == 10240
    assert receipt["browser"]["finalAnalyzedThroughPerformanceMs"] == 10240
    assert receipt["parity"]["publicationCountEqual"] is True
    assert receipt["parity"]["observationCountEqual"] is True
    assert receipt["parity"]["finalAnalyzedThroughEqual"] is True


def test_d2r1_worker_and_bridge_are_real_implementation_paths() -> None:
    worker_source = WORKER.read_text(encoding="utf-8")
    harness_source = HARNESS.read_text(encoding="utf-8")
    bridge_source = BRIDGE.read_text(encoding="utf-8")

    assert "new Worker('/worker.js')" in harness_source
    assert "state.prev[pitch] = 0" not in harness_source
    assert "state.prev[pitch] = 0" not in worker_source
    assert "runOnlineAmtStreamingCandidateFromHopArtifact" in bridge_source
    assert "TIMING_CORRECTION_MS = -162.93750000004252" in bridge_source
    for performer in [f"p{index}" for index in range(15, 23)]:
        assert f"_{performer}" not in worker_source
        assert f"/{performer}" not in worker_source
        assert f"\\{performer}" not in worker_source
