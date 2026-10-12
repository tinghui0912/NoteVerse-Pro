from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
REPORTS = REPO_ROOT / "backend" / "research" / "reports"
SCRIPT = REPO_ROOT / "backend" / "scripts" / "qualify_online_amt_browser_stateful.py"


def read_report(name: str) -> dict:
    path = REPORTS / f"{name}_2026-10-12.json"
    assert path.exists(), f"missing D.2 report: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


def test_online_amt_frozen_identity_and_config_are_exact() -> None:
    report = read_report("phase9g_d2_online_amt_browser_source_identity")

    assert report["qualificationStatus"] == "PASS"
    candidate = report["sourceCandidate"]
    assert candidate["candidateId"] == "online-amt-calibrated-v1"
    assert candidate["profileId"] == "online-amt-calibration-native-boost-1"
    assert candidate["configurationSha256"] == "0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375"
    assert candidate["actualRepoCommit"] == "ad12550909a1d86f699097d11885f427054a5ac2"
    assert candidate["checkpoint"]["sha256"] == "54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0"
    assert candidate["checkpoint"]["byteSize"] == 178804960
    assert report["frozenConfigValues"] == {
        "timingCorrectionMs": -162.93750000004252,
        "publishedOnsetBoost": 1.0,
        "pseudoIntensityShortcut": "NATIVE",
        "hopSamples": 512,
        "sampleRateHz": 16000,
    }
    assert report["p15p22InferenceIncrease"] == 0


def test_online_amt_explicit_state_contract_matches_upstream_python() -> None:
    report = read_report("phase9g_d2_online_amt_explicit_state_contract")

    assert report["upstreamConstants"] == {
        "SAMPLE_RATE": 16000,
        "HOP_LENGTH": 512,
        "N_MELS": 229,
        "WINDOW_LENGTH": 2048,
        "MEL_FMIN": 30,
        "MEL_FMAX": 8000,
    }
    assert report["checkpointMetadata"] == {
        "model_complexity_conv": 64,
        "model_complexity_lstm": 32,
        "language_hidden_size": 512,
    }
    state = report["mutableState"]
    assert state["audio_buffer"]["shape"] == [1, 5120]
    assert state["mel_buffer"]["shape"] == [1, 229, 7]
    assert state["acoustic_layer_outputs[0]"]["shape"] == [1, 64, 5, 229]
    assert state["acoustic_layer_outputs[1]"]["shape"] == [1, 64, 3, 114]
    assert state["hidden_h"]["shape"] == [2, 1, 512]
    assert state["hidden_c"]["shape"] == [2, 1, 512]
    assert state["prev_output"]["shape"] == [1, 1, 88]
    assert state["prev_output"]["dtype"] == "int64"
    assert state["num_under_thr"]["value"] == 0
    assert report["stateContractVersion"] == "online_amt_explicit_state_contract_v1"


def test_online_amt_mel_and_step_parity_receipts_are_honest_about_browser_blocker() -> None:
    mel = read_report("phase9g_d2_online_amt_mel_preprocessing_parity")
    step = read_report("phase9g_d2_online_amt_browser_step_parity")

    assert mel["summary"]["status"] == "PASS"
    assert mel["summary"]["maxAbsDelta"] <= 1e-6
    assert step["pythonOracle"]["hopCount"] >= 300
    assert step["timingCorrectionMs"] == -162.93750000004252
    assert step["chosenStateParity"]["status"] == "NOT_EXECUTED"
    assert step["browserWebGpuParity"]["status"] == "NOT_EXECUTED"
    assert step["onnxExport"]["status"] in {"EXPORTED_LM_STEP_ONLY", "BLOCKED"}
    assert step["parityHierarchy"]["productResearchBridge"] == "BROWSER_HOP_ARTIFACT_NOT_AVAILABLE"


def test_online_amt_native_gate_boundary_and_segment_reset_are_recorded() -> None:
    report = read_report("phase9g_d2_online_amt_browser_step_parity")
    gate = report["nativeGateBoundaryParity"]

    assert gate["threshold"] == 0.05
    assert gate["patience"] == 100
    assert gate["boundary"] == "num_under_thr > patience"
    rows = {row["silentHopCount"]: row for row in gate["rows"]}
    assert rows[99]["shortCircuitExpected"] is False
    assert rows[100]["shortCircuitExpected"] is False
    assert rows[101]["shortCircuitExpected"] is True
    assert rows[102]["shortCircuitExpected"] is True
    assert gate["nonSilentRecovery"]["numUnderThrBefore"] == 101
    assert gate["nonSilentRecovery"]["numUnderThrAfter"] == 0

    reset = report["segmentReset"]
    assert reset["initialStateDeterministic"] is True
    assert reset["stateChangesAfterHop"] is True
    assert reset["freshSegmentResetRestoresInitialState"] is True
    assert report["statefulMattersDiagnostic"]["statefulEffectDemonstrated"] is True


def test_online_amt_runtime_receipt_forbids_wasm_fallback_and_production_activation() -> None:
    runtime = read_report("phase9g_d2_online_amt_default_browser_runtime")
    feasibility = read_report("phase9g_d2_online_amt_feasibility_receipt")

    assert runtime["ortWebVersionRequiredFirst"] == "1.20.1"
    assert runtime["unsafeWebGpuFlagUsed"] is False
    assert runtime["wasmFallbackUsed"] is False
    assert runtime["browserRuntimeStatus"] == "NOT_EXECUTED_COMPLETE_BROWSER_STEP_BLOCKED"
    assert runtime["memoryTelemetry"]["status"] == "NOT_MEASURED"
    assert runtime["vramTelemetry"]["status"] == "NOT_MEASURED"

    assert feasibility["outcome"] == "ONLINE_AMT_BROWSER_EXPORT_BLOCKED"
    assert feasibility["deploymentIdentityCreated"] is False
    assert feasibility["productionMicrophoneEnabled"] is False
    assert feasibility["productionWinnerSelected"] is False
    assert feasibility["phase9gBHistoricalConclusion"] == {"outcome": "STATISTICAL_TIE", "winner": None}
    assert feasibility["p15p22InferenceIncrease"] == 0


def test_online_amt_d2_script_does_not_reference_blind_performers() -> None:
    source = SCRIPT.read_text(encoding="utf-8")

    for performer in [f"p{index}" for index in range(15, 23)]:
        assert f"_{performer}" not in source
        assert f"/{performer}" not in source
        assert f"\\{performer}" not in source
        assert f":{performer}" not in source
    assert "p07" in source
