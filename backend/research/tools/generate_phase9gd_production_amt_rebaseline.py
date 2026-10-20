from __future__ import annotations

import hashlib
import json
import shutil
import subprocess
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT / "backend" / "research"))

from product_amt_rebaseline import (  # noqa: E402
    AcousticObservation,
    ExpectedStrike,
    SYNTHETIC_CONTRACT_STATUS,
    chosen_state_mismatch_count,
    decode_conservative_hybrid,
    decode_contiguous_peak,
    decode_toy_regressed_local_peak,
    finalize_observations,
    initial_online_amt_toy_state,
    linear_resample,
    run_online_amt_bad_skip_intermediate,
    run_online_amt_grouped,
    run_online_amt_sequential,
    toy_windowed_sinc_resample_contract,
)


REPORTS = REPO_ROOT / "backend" / "research" / "reports"
REPORT_DATE = "2026-10-13"


def sha256_file(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def git_head() -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, text=True).strip()


def optional_json(path: Path) -> dict | None:
    if not path.exists():
        return None
    return json.loads(path.read_text(encoding="utf-8"))


def npm_package_lock_sha() -> str:
    lock = REPO_ROOT / "apps/customer-web/package-lock.json"
    return sha256_file(lock) if lock.exists() else "NOT_AVAILABLE"


def npm_view(package: str) -> dict[str, object]:
    npm = shutil.which("npm") or shutil.which("npm.cmd")
    if not npm:
        return {"status": "NOT_AVAILABLE", "error": "npm executable not found on PATH"}
    try:
        raw = subprocess.check_output(
            [npm, "view", package, "version", "dist.integrity", "dist.tarball", "--json"],
            cwd=REPO_ROOT,
            text=True,
        )
        return json.loads(raw)
    except Exception as exc:  # pragma: no cover - depends on local npm/network
        return {"status": "NOT_AVAILABLE", "error": str(exc)}


def online_amt_grouped_contract() -> dict:
    hops = [[(index + 1) * 0.01, (-1) ** index * 0.02, 0.005 * (index % 3)] for index in range(16)]
    sequential = run_online_amt_sequential(initial_online_amt_toy_state(), hops)
    synthetic_rows = {}
    for k in [1, 2, 4, 8]:
        grouped = run_online_amt_grouped(initial_online_amt_toy_state(), hops, k)
        bad = run_online_amt_bad_skip_intermediate(initial_online_amt_toy_state(), hops, k)
        synthetic_rows[f"K={k}"] = {
            "evidenceStatus": SYNTHETIC_CONTRACT_STATUS,
            "semanticContract": "PASS" if chosen_state_mismatch_count(sequential, grouped) == 0 else "FAIL",
            "chosenStateMismatchCount": chosen_state_mismatch_count(sequential, grouped),
            "skippedIntermediateTransitionMismatchCount": chosen_state_mismatch_count(sequential, bad),
            "mayPopulateRuntimeEvidence": False,
            "mayRankCandidate": False,
        }
    return {
        "candidateId": "online-amt-calibrated-v1",
        "frozenIdentity": {
            "sampleRateHz": 16000,
            "hopSamples": 512,
            "hopMs": 32,
            "timingCorrectionMs": -162.93750000004252,
            "onsetBoost": 1.0,
            "pseudoIntensity": "NATIVE",
        },
        "syntheticContractTests": synthetic_rows,
        "realGroupedGraphExecution": {
            "status": "ONLINE_AMT_GROUPED_RUNTIME_BLOCKED",
            "missingPrerequisite": "Real static K-hop ONNX unroll exporter and browser worker execution for K=1/2/4/8 were not present in this repair commit.",
            "requiredSourceInfrastructure": [
                "backend/research/tools/qualify_online_amt_browser_stateful_d2r1.py",
                "backend/research/browser_runtime/online_amt_stateful_browser_worker.mjs",
                "backend/research/browser_runtime/online_amt_stateful_browser_harness.mjs",
            ],
            "kHopGraphIdentities": {
                f"K={k}": {
                    "status": "NOT_EXPORTED",
                    "path": None,
                    "sha256": None,
                    "byteSize": None,
                    "opset": None,
                    "inputNames": [],
                    "outputNames": [],
                    "checkpointSha256": "54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0",
                }
                for k in [1, 2, 4, 8]
            },
            "semanticParity": "NOT_MEASURED_REAL_MODEL",
            "chromeRuntime": "NOT_MEASURED",
            "edgeRuntime": "NOT_MEASURED",
            "timerDrivenBrowserFeeder": "NOT_MEASURED_REAL_BROWSER",
            "decision": "REBASELINE_RUNTIME_EVIDENCE_INCOMPLETE",
        },
    }


def robust_baseline() -> dict:
    d1r = optional_json(REPORTS / "phase9g_d1r_robust_default_browser_runtime_2026-10-12.json") or {}
    identity = optional_json(REPORTS / "phase9g_d3_robust_browser_v1_identity_2026-10-13.json") or {}
    source = [0.0, 0.2, 0.6, 0.1, -0.1, 0.0, 0.3, 0.0]
    linear = linear_resample(source, 16)
    toy_sinc = toy_windowed_sinc_resample_contract(source, 16)
    onset = [0.01, 0.31, 0.44, 0.29, 0.02, 0.35, 0.34, 0.01]
    frame = [0.1, 0.2, 0.6, 0.4, 0.1, 0.07, 0.06, 0.02]
    regression = [0.0, -0.2, -0.1, 0.0, 0.0, 0.15, -0.05, 0.0]
    return {
        "candidateId": "robust-browser-v1",
        "sourceIdentitySha256": identity.get("deploymentIdentitySha256", "NOT_AVAILABLE"),
        "ortWebHistorical": "1.20.1",
        "ortWebRebaselineTarget": "1.30.0",
        "ortWeb130RuntimeExecution": "NOT_EXECUTED_IN_THIS_REPAIR_COMMIT",
        "runtimeEvidenceRetained": {
            "sourceReport": "backend/research/reports/phase9g_d1r_robust_default_browser_runtime_2026-10-12.json",
            "modelLoadLatencyMs": d1r.get("modelLoadLatencyMs"),
            "firstInferenceLatencyMs": d1r.get("firstInferenceLatencyMs"),
            "distinctWindowInferenceLatencyMs": d1r.get("distinctWindowInferenceLatencyMs"),
        },
        "preprocessingSensitivity": {
            "linearInterpolationContractSha256": hashlib.sha256(json.dumps(linear).encode()).hexdigest(),
            "toyWindowedSincContractSha256": hashlib.sha256(json.dumps(toy_sinc).encode()).hexdigest(),
            "selectionStatus": "TOY_RESAMPLER_CONTRACT_ONLY_NO_ROBUST_PREPROCESSING_SELECTION",
            "productionValidationRequired": [
                "48000_to_16000",
                "44100_to_16000",
                "impulse",
                "swept_frequency",
                "near_nyquist",
                "piano_like_multitone",
            ],
        },
        "decoderSensitivity": {
            "contiguousThresholdPeak": [event.__dict__ for event in decode_contiguous_peak(onset, frame, 0.30, 0.05)],
            "toyRegressedLocalPeakNotUpstreamEquivalent": [event.__dict__ for event in decode_toy_regressed_local_peak(onset, frame, regression, 0.30, 0.05)],
            "conservativeHybrid": [event.__dict__ for event in decode_conservative_hybrid(onset, frame, regression, 0.30, 0.05)],
            "upstreamRegressionPostProcessorStatus": "NOT_IMPLEMENTED_IN_THIS_REPAIR_COMMIT",
            "pinnedUpstreamReference": {
                "repository": "qiuqiangkong/piano_transcription_inference",
                "commit": "0226e74cbc805660e34bbd6a8fed2083890ebb88",
                "file": "piano_transcription_inference/utilities.py",
                "symbols": [
                    "RegressionPostProcessor.get_binarized_output_from_regression",
                    "RegressionPostProcessor.is_monotonic_neighbour",
                ],
            },
            "selectionStatus": "TOY_DECODER_CONTRACT_ONLY_NO_ROBUST_DECODER_SELECTION",
        },
        "cadenceSweep": {
            "cadencesMs": [320, 400, 500, 600],
            "status": "NOT_EXECUTED_IN_THIS_REPAIR_COMMIT",
        },
    }


def basic_pitch_baseline() -> dict:
    historical = REPO_ROOT / "backend/research/reports/basic_pitch_browser_feasibility.md"
    return {
        "candidateId": "spotify-basic-pitch-browser",
        "upstreamPackage": "@spotify/basic-pitch",
        "npmVersionObserved": npm_view("@spotify/basic-pitch@1.0.1"),
        "historicalReport": "backend/research/reports/basic_pitch_browser_feasibility.md" if historical.exists() else None,
        "currentPhaseBrowserExecution": "NOT_EXECUTED_IN_THIS_REPAIR_COMMIT",
        "productionCandidateStatus": "LIGHTWEIGHT_CHALLENGER_REQUIRES_CURRENT_BROWSER_RUNTIME_AND_OBSERVATION_BRIDGE",
    }


def product_scorer_architecture() -> dict:
    finalizer_fixture = finalize_observations(
        [
            ExpectedStrike("correct", frozenset({60}), 1000, 1120),
            ExpectedStrike("wrong", frozenset({62}), 1300, 1420),
            ExpectedStrike("incomplete", frozenset({64, 67}), 1600, 1720),
            ExpectedStrike("missing", frozenset({69}), 1900, 2020),
        ],
        [
            AcousticObservation("obs-correct", 60, 1005),
            AcousticObservation("obs-wrong", 63, 1302),
            AcousticObservation("obs-partial", 64, 1601),
            AcousticObservation("obs-extra", 72, 2300),
        ],
        window_ms=60,
        analyzed_through_ms=2400,
    )
    return {
        "audioOnlyNeuralInputs": True,
        "forbiddenAdapterInputs": [
            "expected pitch",
            "score note",
            "truth MIDI",
            "target timestamp",
            "correctness label",
            "scenario category",
        ],
        "oneToOneAssignmentRequired": True,
        "verdictsCoveredByTests": ["correct", "missing", "wrong", "incomplete_chord", "extra"],
        "timeAwareFinalizerFixture": {
            "evidenceStatus": SYNTHETIC_CONTRACT_STATUS,
            "result": finalizer_fixture,
        },
        "latencyByVerdict": {
            "status": "NO_PRODUCT_LATENCY_EVIDENCE_REPORTED",
            "note": "Hard-coded latency samples from a925d6f6 were removed. Synthetic latency formatting may only be used in unit tests.",
        },
    }


def main() -> None:
    start = git_head()
    report = {
        "schemaVersion": 2,
        "artifact": "phase9g_dr1_real_grouped_runtime_and_finalizer_repair",
        "phase": "PHASE_9G_DR1_REAL_GROUPED_RUNTIME_AND_FINALIZER_REPAIR",
        "date": REPORT_DATE,
        "startGitHead": start,
        "historicalPhase9gBConclusion": {"outcome": "STATISTICAL_TIE", "winner": None},
        "productionMicrophoneEnabled": False,
        "productionWinnerSelected": False,
        "p15p22InferenceIncrease": 0,
        "runtimeIdentities": {
            "onnxruntimeWebHistoricalPinned": "1.20.1",
            "onnxruntimeWebResearchTarget": npm_view("onnxruntime-web@1.30.0"),
            "customerWebPackageLockSha256": npm_package_lock_sha(),
        },
        "onlineAmt": online_amt_grouped_contract(),
        "robustByteDance": robust_baseline(),
        "basicPitch": basic_pitch_baseline(),
        "offlineReferences": {
            "transkunV2": "NOT_RUN_IN_THIS_REPAIR_COMMIT",
            "ariaAmt": "NOT_RUN_IN_THIS_REPAIR_COMMIT",
        },
        "productScorerArchitecture": product_scorer_architecture(),
        "sourceFileHashes": {
            "rebaselineHelper": sha256_file(REPO_ROOT / "backend/research/product_amt_rebaseline.py"),
            "reportGenerator": sha256_file(REPO_ROOT / "backend/research/tools/generate_phase9gd_production_amt_rebaseline.py"),
        },
        "githubStatuses": "NOT_QUERIED",
        "githubWorkflowRuns": "NOT_QUERIED",
        "recommendation": "REBASELINE_RUNTIME_EVIDENCE_INCOMPLETE",
        "recommendationScope": (
            "Repair phase only; not a final production winner and not D4 final qualification. "
            "Synthetic contracts are explicitly separated from model/runtime evidence. Required real Online-AMT "
            "K-hop ONNX/browser executions did not complete."
        ),
    }
    out = REPORTS / f"phase9g_dr1_real_grouped_runtime_and_finalizer_repair_{REPORT_DATE}.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(out.relative_to(REPO_ROOT)), "recommendation": report["recommendation"]}, indent=2))


if __name__ == "__main__":
    main()
