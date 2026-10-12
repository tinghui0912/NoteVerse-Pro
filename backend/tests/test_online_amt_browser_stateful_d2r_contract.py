from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
REPORTS = REPO_ROOT / "backend" / "research" / "reports"
HARNESS = REPO_ROOT / "backend" / "research" / "browser_runtime" / "online_amt_stateful_browser_harness.mjs"


def read_report(name: str) -> dict:
    path = REPORTS / f"{name}_2026-10-13.json"
    assert path.exists(), f"missing D.2R report: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


def test_d2r_correction_receipt_preserves_d2_history() -> None:
    report = read_report("phase9g_d2r_correction_receipt")

    assert report["d2HistoricalReportedOutcome"] == "ONLINE_AMT_BROWSER_EXPORT_BLOCKED"
    assert report["d2rCorrectedInterpretation"] == "ONLINE_AMT_BROWSER_FEASIBILITY_UNRESOLVED_IMPLEMENTATION_INCOMPLETE"
    assert report["d2MelEvidenceReclassifiedAs"] == "PYTHON_MEL_FORMULA_ORACLE_PARITY"
    assert report["retainedD2Evidence"]["lmStepOnnxExport"] == "PASS"
    assert report["p15p22InferenceIncrease"] == 0


def test_d2r_exports_mel_acoustic_and_native_lm_graphs() -> None:
    report = read_report("phase9g_d2r_online_amt_graph_export")
    graphs = report["graphs"]

    assert graphs["mel"]["status"] == "PASS"
    assert "Conv" in graphs["mel"]["operators"]
    assert "Log" in graphs["mel"]["operators"]
    assert graphs["acoustic"]["status"] == "PASS"
    assert "MaxPool" in graphs["acoustic"]["operators"]
    assert graphs["lmNative"]["status"] == "PASS"
    assert "LSTM" in graphs["lmNative"]["operators"]
    assert graphs["lmFloat"]["status"] == "PASS"
    assert "Sigmoid" in graphs["lmFloat"]["operators"]
    assert report["pythonExportableParity"]["manualFloatLmChosenMismatchCount"] == 0


def test_d2r_browser_layer_and_chosen_state_parity() -> None:
    layer = read_report("phase9g_d2r_online_amt_browser_layer_parity")
    step = read_report("phase9g_d2r_online_amt_browser_step_parity")

    assert layer["pythonToChrome"]["status"] == "PASS"
    assert layer["pythonToEdge"]["status"] == "PASS"
    assert step["nativeLmWebGpuAttempt"]["status"] == "PASS"
    assert step["manualFloatLstmNeeded"] is False
    assert step["chrome"]["chosenState"]["totalPitchHopComparisons"] == 320 * 88
    assert step["chrome"]["chosenState"]["mismatchCount"] == 0
    assert step["edge"]["chosenState"]["mismatchCount"] == 0
    assert step["nativeGateBrowserParity"]["status"] == "PASS"
    gate_rows = {row["silentHopCount"]: row for row in step["nativeGateBrowserParity"]["boundaryFixture"]["rows"]}
    assert gate_rows[100]["shortCircuit"] is False
    assert gate_rows[101]["shortCircuit"] is True
    assert gate_rows[101]["melAdvanced"] == gate_rows[100]["melAdvanced"]
    assert step["nativeGateBrowserParity"]["boundaryFixture"]["nonSilentRecovery"]["after"]["numUnderThr"] == 0
    assert step["unsafeWebGpuFlagUsed"] is False
    assert step["wasmFallbackUsed"] is False


def test_d2r_tail_boundary_and_runtime_outcome_are_explicit() -> None:
    bridge = read_report("phase9g_d2r_online_amt_publication_bridge_parity")
    runtime = read_report("phase9g_d2r_online_amt_default_browser_runtime")
    feasibility = read_report("phase9g_d2r_online_amt_feasibility_receipt")

    assert bridge["authoritativeTailRequirement"] == {
        "correctionDelaySamples": 2608,
        "requiredProcessedSamples": 166912,
        "requiredContextTailSamples": 3072,
    }
    assert bridge["ownedPerformanceMs"] == 10240
    assert bridge["requiredProcessingFrontierMs"] == 10432
    assert bridge["finalOwnedAnalyzedThroughPerformanceMs"] == 10240

    assert runtime["chromeDefaultWebGpu"]["status"] == "PASS"
    assert runtime["edgeDefaultWebGpu"]["status"] == "PASS"
    assert runtime["chromeDefaultWebGpu"]["backlogClassification"] == "BACKLOG_PRESENT_OR_GROWING"
    assert runtime["edgeDefaultWebGpu"]["backlogClassification"] == "BACKLOG_PRESENT_OR_GROWING"
    assert feasibility["outcome"] == "ONLINE_AMT_BROWSER_REALTIME_BACKLOG_UNSTABLE"
    assert feasibility["productionMicrophoneEnabled"] is False
    assert feasibility["productionWinnerSelected"] is False
    assert feasibility["phase9gBHistoricalConclusion"] == {"outcome": "STATISTICAL_TIE", "winner": None}
    assert feasibility["p15p22InferenceIncrease"] == 0


def test_d2r_browser_harness_schema_has_no_unsafe_or_wasm_fallback() -> None:
    source = HARNESS.read_text(encoding="utf-8")

    assert "allow-unsafe-webgpu" in source
    assert "wasmFallbackUsed: false" in source
    assert "PIPELINE_LM === 'native'" in source
    for performer in [f"p{index}" for index in range(15, 23)]:
        assert f"_{performer}" not in source
        assert f"/{performer}" not in source
        assert f"\\{performer}" not in source
