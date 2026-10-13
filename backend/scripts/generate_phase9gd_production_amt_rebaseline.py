from __future__ import annotations

import hashlib
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(REPO_ROOT / "backend" / "research"))

from product_amt_rebaseline import (
    classify_realtime_queue,
    decode_conservative_hybrid,
    decode_contiguous_peak,
    decode_upstream_regressed,
    initial_online_amt_toy_state,
    latency_by_verdict,
    linear_resample,
    run_online_amt_bad_skip_intermediate,
    run_online_amt_grouped,
    run_online_amt_sequential,
    windowed_sinc_resample,
    chosen_state_mismatch_count,
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


def online_amt_grouped_contract() -> dict:
    hops = [[(index + 1) * 0.01, (-1) ** index * 0.02, 0.005 * (index % 3)] for index in range(16)]
    sequential = run_online_amt_sequential(initial_online_amt_toy_state(), hops)
    rows = {}
    for k in [1, 2, 4, 8]:
        grouped = run_online_amt_grouped(initial_online_amt_toy_state(), hops, k)
        bad = run_online_amt_bad_skip_intermediate(initial_online_amt_toy_state(), hops, k)
        service_times = {
            1: [54.75, 52.8, 56.1, 55.0],
            2: [78.0, 80.0, 77.0, 82.0],
            4: [119.0, 122.0, 118.0, 121.0],
            8: [211.0, 214.0, 209.0, 216.0],
        }[k]
        arrival = k * 32
        rows[f"K={k}"] = {
            "semanticContract": "PASS" if chosen_state_mismatch_count(sequential, grouped) == 0 else "FAIL",
            "chosenStateMismatchCount": chosen_state_mismatch_count(sequential, grouped),
            "skippedIntermediateTransitionMismatchCount": chosen_state_mismatch_count(sequential, bad),
            "browserGroupedGraphExport": "NOT_EXECUTED_IN_THIS_REBASELINE_COMMIT",
            "realTimerDrivenBrowserFeeder": "NOT_EXECUTED_IN_THIS_REBASELINE_COMMIT",
            "queueClassificationFromMeasuredD2R1AndGroupedCapacityTargets": classify_realtime_queue(service_times, arrival),
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
        "groupedKResults": rows,
        "phaseConclusion": "ONLINE_AMT_GROUPED_BROWSER_REALTIME_UNRESOLVED_GRAPH_EXPORT_REQUIRED",
    }


def robust_baseline() -> dict:
    d1r = optional_json(REPORTS / "phase9g_d1r_robust_default_browser_runtime_2026-10-12.json") or {}
    identity = optional_json(REPORTS / "phase9g_d3_robust_browser_v1_identity_2026-10-13.json") or {}
    source = [0.0, 0.2, 0.6, 0.1, -0.1, 0.0, 0.3, 0.0]
    linear = linear_resample(source, 16)
    sinc = windowed_sinc_resample(source, 16)
    onset = [0.01, 0.31, 0.44, 0.29, 0.02, 0.35, 0.34, 0.01]
    frame = [0.1, 0.2, 0.6, 0.4, 0.1, 0.07, 0.06, 0.02]
    regression = [0.0, -0.2, -0.1, 0.0, 0.0, 0.15, -0.05, 0.0]
    return {
        "candidateId": "robust-browser-v1",
        "sourceIdentitySha256": identity.get("deploymentIdentitySha256", "NOT_AVAILABLE"),
        "ortWebHistorical": "1.20.1",
        "ortWebRebaselineTarget": "1.30.0",
        "ortWeb130RuntimeExecution": "NOT_EXECUTED_IN_THIS_REBASELINE_COMMIT",
        "runtimeEvidenceRetained": {
            "sourceReport": "backend/research/reports/phase9g_d1r_robust_default_browser_runtime_2026-10-12.json",
            "modelLoadLatencyMs": d1r.get("modelLoadLatencyMs"),
            "firstInferenceLatencyMs": d1r.get("firstInferenceLatencyMs"),
            "distinctWindowInferenceLatencyMs": d1r.get("distinctWindowInferenceLatencyMs"),
        },
        "preprocessingSensitivity": {
            "linearInterpolationSha256": hashlib.sha256(json.dumps(linear).encode()).hexdigest(),
            "windowedSincSha256": hashlib.sha256(json.dumps(sinc).encode()).hexdigest(),
            "selectionStatus": "DEFINITIONS_FROZEN_NO_EXTERNAL_ACCURACY_INSPECTED",
        },
        "decoderSensitivity": {
            "contiguousThresholdPeak": [event.__dict__ for event in decode_contiguous_peak(onset, frame, 0.30, 0.05)],
            "upstreamRegressed": [event.__dict__ for event in decode_upstream_regressed(onset, frame, regression, 0.30, 0.05)],
            "conservativeHybrid": [event.__dict__ for event in decode_conservative_hybrid(onset, frame, regression, 0.30, 0.05)],
            "selectionStatus": "VARIANT_DEFINITIONS_FROZEN_NO_EXTERNAL_ACCURACY_INSPECTED",
        },
        "cadenceSweep": {
            "cadencesMs": [320, 400, 500, 600],
            "status": "PLANNED_FOR_BROWSER_EXECUTION_AFTER_ORT_130_HARNESS",
        },
    }


def basic_pitch_baseline() -> dict:
    historical = REPO_ROOT / "backend/research/reports/basic_pitch_browser_feasibility.md"
    return {
        "candidateId": "spotify-basic-pitch-browser",
        "upstreamPackage": "@spotify/basic-pitch",
        "npmVersionObserved": "1.0.1",
        "historicalReport": "backend/research/reports/basic_pitch_browser_feasibility.md" if historical.exists() else None,
        "currentPhaseBrowserExecution": "NOT_EXECUTED_IN_THIS_REBASELINE_COMMIT",
        "productionCandidateStatus": "LIGHTWEIGHT_CHALLENGER_REQUIRES_CURRENT_BROWSER_RUNTIME_AND_OBSERVATION_BRIDGE",
    }


def product_scorer_architecture() -> dict:
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
        "latencyByVerdict": latency_by_verdict({
            "correct": [220, 340, 410],
            "missing": [600, 720, 810],
            "wrong": [260, 390, 500],
            "incomplete_chord": [600, 690, 760],
            "extra": [280, 360, 450],
        }),
    }


def main() -> None:
    start = git_head()
    report = {
        "schemaVersion": 1,
        "artifact": "phase9g_d_production_amt_rebaseline",
        "phase": "9G-D-production-amt-rebaseline",
        "date": REPORT_DATE,
        "startGitHead": start,
        "historicalPhase9gBConclusion": {"outcome": "STATISTICAL_TIE", "winner": None},
        "productionMicrophoneEnabled": False,
        "productionWinnerSelected": False,
        "p15p22InferenceIncrease": 0,
        "runtimeIdentities": {
            "onnxruntimeWebHistoricalPinned": "1.20.1",
            "onnxruntimeWebCurrentStableObserved": "1.30.0",
            "customerWebPackageLockSha256": npm_package_lock_sha(),
        },
        "onlineAmt": online_amt_grouped_contract(),
        "robustByteDance": robust_baseline(),
        "basicPitch": basic_pitch_baseline(),
        "offlineReferences": {
            "transkunV2": "SKIPPED_SETUP_EXPENSIVE_NOT_BLOCKING_REBASELINE",
            "ariaAmt": "SKIPPED_SETUP_EXPENSIVE_NOT_BLOCKING_REBASELINE",
        },
        "productScorerArchitecture": product_scorer_architecture(),
        "recommendation": "NO_EXISTING_CANDIDATE_MEETS_PRODUCT_GATE_CUSTOM_MODEL_REQUIRED",
        "recommendationScope": (
            "Architecture rebaseline only; not a final production winner and not D4 final qualification. "
            "The executable safety contracts are in place, but this commit did not complete the required "
            "ORT Web 1.30 browser executions or real browser grouped Online-AMT graph feeder runs."
        ),
    }
    out = REPORTS / f"phase9g_d_production_amt_rebaseline_{REPORT_DATE}.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"report": str(out.relative_to(REPO_ROOT)), "recommendation": report["recommendation"]}, indent=2))


if __name__ == "__main__":
    main()
