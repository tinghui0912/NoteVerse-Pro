"""Research-only ByteDance Continuous microphone feasibility gate.

This harness records the Phase 4 gate state without modifying production model
manifests or customer-web runtime code. It intentionally fails closed when the
PyTorch checkpoint/export source required for a batch-capable ONNX export is not
available.
"""

from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import os
import platform
import subprocess
from pathlib import Path
from typing import Any


MODEL_SHA256 = "6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5"
MODEL_SIZE_BYTES = 98_691_493
DEFAULT_MODEL = Path("backend/data/work/bytedance_browser_runtime_feasibility/bytedance_note_model_fixed_anchor.onnx")
DEFAULT_FIXTURES = Path("backend/data/work/bytedance_browser_runtime_feasibility/golden_fixtures")
DEFAULT_CHECKPOINT = Path("/app/models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth")
ROLLING_REPORT = Path("backend/research/reports/bytedance_rolling_anchor_feasibility_2026-10-03.json")
WEBGPU_REPORT = Path("backend/research/reports/bytedance_worker_webgpu_smoke_ort_1_20_1.json")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=str(DEFAULT_MODEL))
    parser.add_argument("--fixture-dir", default=str(DEFAULT_FIXTURES))
    parser.add_argument("--checkpoint", default=os.environ.get("NOTEVERSE_BYTEDANCE_CHECKPOINT", str(DEFAULT_CHECKPOINT)))
    parser.add_argument("--output-dir", default="backend/research/reports")
    parser.add_argument("--date", default="2026-10-05")
    args = parser.parse_args()

    repo = _repo_root()
    output_dir = (repo / args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    model_path = (repo / args.model).resolve()
    fixture_dir = (repo / args.fixture_dir).resolve()
    checkpoint_path = Path(args.checkpoint)
    if not checkpoint_path.is_absolute():
      checkpoint_path = (repo / checkpoint_path).resolve()

    context = {
        "generatedAt": dt.datetime.now(dt.UTC).isoformat(),
        "gitHead": _git_head(repo),
        "command": " ".join(["python", "backend/scripts/evaluate_bytedance_continuous_feasibility_gate.py", *os.sys.argv[1:]]),
        "os": {
            "platform": platform.system(),
            "release": platform.release(),
            "machine": platform.machine(),
        },
        "gateCriteria": {
            "correctness": [
                "B=1 batch export raw parity must pass.",
                "B>1 per-item raw parity must pass.",
                "Trusted region must preserve event identity and timing, including repeated notes.",
                "No systematic edge event loss inside selected owned region.",
            ],
            "throughput": [
                "Headed Chrome WebGPU effective unique trusted-audio throughput must be sustainably > realtime.",
                "10-minute queue simulation must not create unbounded backlog.",
                "Post-performance drain must be bounded and product-acceptable.",
            ],
            "browser": [
                "Headed Chrome must acquire WebGPU adapter.",
                "Production-compatible ORT Web runtime must execute selected contract.",
                "No WASM/provider fallback is allowed.",
            ],
        },
        "model": _model_info(model_path),
        "fixtures": _fixture_info(fixture_dir),
        "checkpoint": {
            "path": str(checkpoint_path),
            "exists": checkpoint_path.exists(),
            "sha256": _sha256(checkpoint_path) if checkpoint_path.exists() else None,
            "byteSize": checkpoint_path.stat().st_size if checkpoint_path.exists() else None,
        },
        "historicalEvidence": {
            "rollingAnchor": _read_json(repo / ROLLING_REPORT),
            "webgpuSmoke": _read_json(repo / WEBGPU_REPORT),
        },
    }

    checkpoint_missing = not checkpoint_path.exists()
    model_ok = (
        context["model"]["exists"]
        and context["model"]["sha256"] == MODEL_SHA256
        and context["model"]["byteSize"] == MODEL_SIZE_BYTES
    )
    fixture_count = len(context["fixtures"]["fixtures"])

    batch_status = "BLOCKED" if checkpoint_missing else "NOT_EXECUTED"
    batch_reason = (
        "PyTorch checkpoint/export source is not available in this workspace; "
        "cannot generate a research-only [B,29120] ONNX export."
        if checkpoint_missing
        else "Batch export support has not been executed by this harness."
    )

    batch_report = {
        **_base(context, "batch_export_parity"),
        "status": batch_status,
        "reason": batch_reason,
        "productionOnnxVerified": model_ok,
        "requestedBatchSizes": [1, 2, 4, 8],
        "b1Parity": None,
        "b2Parity": None,
        "b4Parity": None,
        "b8Parity": None,
    }

    benchmark_report = {
        **_base(context, "headed_browser_batch_benchmark"),
        "status": "BLOCKED" if batch_status == "BLOCKED" else "NOT_EXECUTED",
        "reason": "Batch benchmark requires a batch-capable ONNX export with raw parity first.",
        "provider": "webgpu",
        "ortVersion": "1.20.1",
        "requestedBatchSizes": [1, 2, 4, 8],
        "measurements": {str(size): None for size in [1, 2, 4, 8]},
        "historicalSingleWindowSmokeSummary": _summarize_webgpu_smoke(context["historicalEvidence"]["webgpuSmoke"]),
    }

    trusted_report = {
        **_base(context, "trusted_region"),
        "status": "BLOCKED" if batch_status == "BLOCKED" else "NOT_EXECUTED",
        "reason": (
            "Trusted-region experiment requires batch export parity and enough dev/cal audio windows "
            "covering positions across the model input."
        ),
        "candidateDatasetCoverage": {
            "availableGoldenFixtureCount": fixture_count,
            "requiredCategories": [
                "single note",
                "chord",
                "same-note retrigger",
                "dense repeated pitch",
                "fast scale / adjacent pitches",
                "partial overlapping notes",
                "soft attack",
                "loud attack",
            ],
            "availableFixtureIds": [item["fixtureId"] for item in context["fixtures"]["fixtures"]],
        },
        "selectedTrustedOutputRegion": None,
    }

    backlog_report = {
        **_base(context, "queue_backlog_simulation"),
        "status": "BLOCKED" if batch_status == "BLOCKED" else "NOT_EXECUTED",
        "reason": "Backlog simulation requires measured batch latency sequence and selected unique trusted-output duration.",
        "durations": {
            "60s": None,
            "5min": None,
            "10min": None,
        },
        "historicalRollingSummary": _summarize_rolling(context["historicalEvidence"]["rollingAnchor"]),
    }

    verdict = "INCONCLUSIVE"
    blockers = []
    if not model_ok:
        blockers.append("Production ONNX asset is missing or does not match expected SHA/size.")
    if checkpoint_missing:
        blockers.append("PyTorch checkpoint/export source is unavailable, so batch export parity cannot be executed.")
    if fixture_count < 8:
        blockers.append("Available golden fixtures do not cover the required trusted-region dataset categories.")

    decision_report = {
        **_base(context, "final_decision"),
        "verdict": verdict,
        "decisionRule": "INCONCLUSIVE is allowed only when critical environment or fixture inputs are missing.",
        "blockers": blockers,
        "passCriteriaSatisfied": False,
        "failCriteriaSatisfied": False,
        "continuousMicProductionState": "CONTINUOUS_ANALYSIS_UNAVAILABLE",
        "requiredNextInputs": [
            "Provide the ByteDance PyTorch checkpoint/export source in the research environment.",
            "Generate a research-only dynamic batch ONNX export.",
            "Run raw B=1/B=2/B=4/B=8 parity against golden windows.",
            "Create or identify dev/cal fixtures covering all trusted-region categories.",
            "Run headed Chrome WebGPU batch throughput and backlog simulation after parity passes.",
        ],
    }

    outputs = {
        f"bytedance_continuous_batch_export_parity_{args.date}.json": batch_report,
        f"bytedance_continuous_browser_batch_benchmark_{args.date}.json": benchmark_report,
        f"bytedance_continuous_trusted_region_{args.date}.json": trusted_report,
        f"bytedance_continuous_backlog_simulation_{args.date}.json": backlog_report,
        f"bytedance_continuous_feasibility_decision_{args.date}.json": decision_report,
    }
    for name, payload in outputs.items():
        (output_dir / name).write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    md_path = output_dir / f"bytedance_continuous_feasibility_decision_{args.date}.md"
    md_path.write_text(_markdown(decision_report, batch_report, benchmark_report, trusted_report, backlog_report), encoding="utf-8")
    print(json.dumps({"status": "written", "verdict": verdict, "outputs": sorted(outputs) + [md_path.name]}, indent=2))


def _base(context: dict[str, Any], report_type: str) -> dict[str, Any]:
    return {
        "reportType": report_type,
        "generatedAt": context["generatedAt"],
        "gitHead": context["gitHead"],
        "command": context["command"],
        "os": context["os"],
        "model": context["model"],
        "checkpoint": context["checkpoint"],
    }


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[2]


def _git_head(repo: Path) -> str | None:
    try:
        return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
    except Exception:
        return None


def _sha256(path: Path) -> str:
    hasher = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def _model_info(path: Path) -> dict[str, Any]:
    return {
        "path": str(path),
        "exists": path.exists(),
        "byteSize": path.stat().st_size if path.exists() else None,
        "sha256": _sha256(path) if path.exists() else None,
        "expectedByteSize": MODEL_SIZE_BYTES,
        "expectedSha256": MODEL_SHA256,
        "inputShape": [1, 29120],
    }


def _fixture_info(fixture_dir: Path) -> dict[str, Any]:
    manifest_path = fixture_dir / "manifest.json"
    manifest = _read_json(manifest_path)
    fixtures = []
    if isinstance(manifest, dict):
        for item in manifest.get("fixtures", []):
            fixtures.append({
                "fixtureId": item.get("fixture_id"),
                "input": item.get("input_tensor_npy"),
                "regOnset": item.get("reg_onset_output_npy"),
                "frame": item.get("frame_output_npy"),
                "expectedPitches": item.get("expected_pitches"),
            })
    return {
        "path": str(fixture_dir),
        "manifestExists": manifest_path.exists(),
        "fixtures": fixtures,
    }


def _read_json(path: Path) -> Any:
    if not path.exists():
        return None
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception as exc:
        return {"error": str(exc), "path": str(path)}


def _summarize_webgpu_smoke(report: Any) -> dict[str, Any] | None:
    if not isinstance(report, dict):
        return None
    smoke = report.get("workerSmoke") or {}
    warm = smoke.get("warmInference") or {}
    runtime = report.get("runtime") or {}
    return {
        "source": "backend/research/reports/bytedance_worker_webgpu_smoke_ort_1_20_1.json",
        "browserVersion": runtime.get("browserVersion"),
        "medianEndToEndMs": warm.get("medianEndToEndMs"),
        "p95EndToEndMs": warm.get("p95EndToEndMs"),
        "medianWorkerOnnxMs": warm.get("medianWorkerOnnxMs"),
        "productionWorkerFactoryUsed": report.get("productionWorkerFactoryUsed"),
    }


def _summarize_rolling(report: Any) -> dict[str, Any] | None:
    if not isinstance(report, dict):
        return None
    result = report.get("result") or {}
    diagnostics = result.get("diagnostics") or result
    return {
        "source": "backend/research/reports/bytedance_rolling_anchor_feasibility_2026-10-03.json",
        "durationMs": result.get("durationMs") or diagnostics.get("durationMs"),
        "submittedAnchorCount": diagnostics.get("submittedAnchorCount"),
        "skippedAnchorCount": diagnostics.get("skippedAnchorCount"),
        "coverageRatio": diagnostics.get("coverageRatio"),
        "maximumCoverageGapMs": diagnostics.get("maximumCoverageGapMs"),
        "note": "Historical rolling path evidence only; not reused as a batch feasibility result.",
    }


def _markdown(
    decision: dict[str, Any],
    batch: dict[str, Any],
    benchmark: dict[str, Any],
    trusted: dict[str, Any],
    backlog: dict[str, Any],
) -> str:
    blockers = "\n".join(f"- {item}" for item in decision["blockers"]) or "- None"
    return f"""# ByteDance Continuous Microphone Feasibility Decision

Date: {decision['generatedAt']}

Git HEAD: `{decision['gitHead']}`

Verdict: `{decision['verdict']}`

Production state: `{decision['continuousMicProductionState']}`

## Gate Criteria

The decision gate was defined before accepting any result as a PASS:

- Raw B=1 batch export parity must pass.
- Raw B=2/B=4/B=8 per-item parity must pass.
- A trusted output region must be demonstrated with stable event identity/timing, including repeated notes.
- Headed Chrome WebGPU effective unique trusted-audio throughput must be sustainably above realtime.
- 10-minute backlog simulation must not grow unbounded.
- No WASM or provider fallback is allowed.

## Blocking Evidence

{blockers}

## Batch Export Parity

Status: `{batch['status']}`

Reason: {batch['reason']}

## Headed Browser Batch Benchmark

Status: `{benchmark['status']}`

Reason: {benchmark['reason']}

Historical single-window smoke summary is included in the JSON report for context only; it is not a batch benchmark.

## Trusted Region

Status: `{trusted['status']}`

Reason: {trusted['reason']}

Available golden fixture count: {trusted['candidateDatasetCoverage']['availableGoldenFixtureCount']}

## Backlog Simulation

Status: `{backlog['status']}`

Reason: {backlog['reason']}

## Decision

`INCONCLUSIVE` is the only defensible result because the batch export/parity gate could not be executed in this workspace. This does not pass ByteDance for Continuous microphone production, and it does not fail the model mathematically; it blocks production integration until the missing research inputs are provided and the gate is rerun.
"""


if __name__ == "__main__":
    main()
