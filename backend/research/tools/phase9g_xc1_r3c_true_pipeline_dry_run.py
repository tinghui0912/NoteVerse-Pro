from __future__ import annotations

import json
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from backend.research.xc1_scientific_bakeoff import (
    OnsetEvent,
    canonical_json_sha256,
    decide_front_runner,
    paired_bootstrap,
    runtime_eligibility,
    score_take,
    sha256_file,
)


REPO_ROOT = Path(__file__).resolve().parents[3]
PHASE = "PHASE_9G_XC1_R3C_SCIENTIFIC_SEMANTICS_F4_FULL_SEALED_BAKEOFF"
CANDIDATES = [
    "robust-browser-v1",
    "online-amt-k8-browser-v1",
    "basic-pitch-browser-v1",
]


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def build_seal_manifest(cells: dict[str, Any], output_dir: Path) -> dict[str, Any]:
    artifact_rows = []
    for candidate_id in CANDIDATES:
        cell = cells[candidate_id]
        artifact_path = output_dir / "predictions" / f"{candidate_id}.json"
        scientific_artifact = {
            "schemaVersion": 1,
            "stage": "XC1_STAGE_A_SCIENTIFIC_PREDICTION_DRY_RUN",
            "phase": PHASE,
            "deploymentId": candidate_id,
            "takeId": cell["takeId"],
            "candidateIdentityDigest": cell["assetIdentity"],
            "canonicalPcmSha256": cell["frozenAcousticInput"]["pcmSha256"],
            "sourceAcousticWavSha256": cell["frozenAcousticInput"]["sourceAcousticWavSha256"],
            "scoreableInterval": cell["frozenAcousticInput"]["scoreableInterval"],
            "browser": cell["browser"],
            "assetVerification": cell["assetShaVerification"],
            "modelLoadMs": cell.get("modelLoadMs"),
            "actualInferenceSessionRunCount": cell.get("actualInferenceSessionRunCount"),
            "processingMs": cell.get("processingMs"),
            "coverage": {
                "windowCount": cell.get("windowCount"),
                "chosenStateHopCount": cell.get("chosenStateHopCount"),
            },
            "acousticObservations": cell.get("acousticObservations", []),
        }
        write_json(artifact_path, scientific_artifact)
        artifact_rows.append({
            "candidateId": candidate_id,
            "takeId": cell["takeId"],
            "artifactPath": str(artifact_path.relative_to(REPO_ROOT)).replace("\\", "/"),
            "artifactSha256": sha256_file(artifact_path),
            "status": "SEALED_DRY_RUN_PREDICTION",
        })
    manifest = {
        "schemaVersion": 1,
        "phase": PHASE,
        "artifact": "xc1_r3c_file_backed_stage_a_seal_manifest_dry_run",
        "expectedCellCount": len(CANDIDATES),
        "cellCount": len(artifact_rows),
        "complete": len(artifact_rows) == len(CANDIDATES),
        "cells": artifact_rows,
    }
    manifest["sealSha256"] = canonical_json_sha256(manifest)
    return manifest


def verify_seal_manifest(manifest: dict[str, Any]) -> dict[str, Any]:
    failures = []
    seen = set()
    for row in manifest["cells"]:
        key = (row["candidateId"], row["takeId"])
        if key in seen:
            failures.append({"cell": row, "failure": "DUPLICATE_CELL"})
        seen.add(key)
        path = REPO_ROOT / row["artifactPath"]
        actual = sha256_file(path)
        if actual != row["artifactSha256"]:
            failures.append({"cell": row, "failure": "ARTIFACT_SHA_MISMATCH", "actualSha256": actual})
        artifact = read_json(path)
        if artifact.get("stage") != "XC1_STAGE_A_SCIENTIFIC_PREDICTION_DRY_RUN":
            failures.append({"cell": row, "failure": "NON_SCIENTIFIC_ARTIFACT_STAGE"})
    return {
        "status": "PASS" if not failures else "FAIL",
        "failures": failures,
        "verifiedCellCount": len(manifest["cells"]) - len(failures),
    }


def mutate_and_prove_seal_failure(manifest: dict[str, Any], work_dir: Path) -> dict[str, Any]:
    first = manifest["cells"][0]
    original = REPO_ROOT / first["artifactPath"]
    backup = work_dir / "mutation-backup.json"
    shutil.copy2(original, backup)
    try:
        with original.open("ab") as handle:
            handle.write(b" ")
        failed = verify_seal_manifest(manifest)
    finally:
        shutil.copy2(backup, original)
    restored = verify_seal_manifest(manifest)
    return {
        "mutationDetected": failed["status"] == "FAIL",
        "restoredStatus": restored["status"],
        "failureSample": failed["failures"][:1],
    }


def to_events(candidate_id: str, artifact: dict[str, Any]) -> list[OnsetEvent]:
    events = []
    for index, observation in enumerate(artifact.get("acousticObservations", [])):
        events.append(OnsetEvent(
            event_id=observation.get("candidateObservationId", f"{candidate_id}:{index}"),
            pitch=int(observation["pitch"]),
            time_ms=float(observation["performanceTimeMs"]),
            confidence=float(observation.get("confidence", 1.0)),
        ))
    return events


def main() -> None:
    work_dir = REPO_ROOT / "backend" / "data" / "work" / "xc1_r3c" / "true_pipeline_dry_run"
    output = REPO_ROOT / "backend" / "data" / "work" / "xc1_r3c" / "phase9g_xc1_r3c_true_complete_pipeline_dry_run_2026-10-14.json"
    acceptance = read_json(REPO_ROOT / "backend" / "data" / "work" / "xc1_r3c" / "phase9g_xc1_r3c_semantic_executor_acceptance_2026-10-14.json")
    if acceptance["overallStatus"] != "SCIENTIFIC_SEMANTIC_EXECUTOR_ACCEPTANCE_PASS":
        raise SystemExit("XC1_R3C_ACCEPTANCE_REQUIRED_BEFORE_DRY_RUN")

    if work_dir.exists():
        shutil.rmtree(work_dir)
    work_dir.mkdir(parents=True)
    seal = build_seal_manifest(acceptance["cells"], work_dir)
    seal_path = work_dir / "stage_a_seal_manifest.json"
    write_json(seal_path, seal)
    seal_verification = verify_seal_manifest(seal)
    mutation = mutate_and_prove_seal_failure(seal, work_dir)
    if seal_verification["status"] != "PASS" or not mutation["mutationDetected"]:
        raise SystemExit("XC1_R3C_DRY_RUN_SEAL_VERIFICATION_FAILED")

    truth_reveal_timestamp = datetime.now(timezone.utc).isoformat()
    take_id = next(iter(acceptance["cells"].values()))["takeId"]
    synthetic_truth = [
        OnsetEvent(event_id=f"truth:{take_id}:c4:0", pitch=60, time_ms=1200.0),
        OnsetEvent(event_id=f"truth:{take_id}:e4:1", pitch=64, time_ms=1800.0),
    ]
    metrics_rows = []
    for candidate_id in CANDIDATES:
        artifact_path = REPO_ROOT / next(row["artifactPath"] for row in seal["cells"] if row["candidateId"] == candidate_id)
        artifact = read_json(artifact_path)
        if sha256_file(artifact_path) != next(row["artifactSha256"] for row in seal["cells"] if row["candidateId"] == candidate_id):
            raise SystemExit("XC1_INVALID_EVALUATION_PREDICTION_CHANGED_AFTER_TRUTH_REVEAL")
        duration_seconds = (
            artifact["scoreableInterval"]["endMs"] - artifact["scoreableInterval"]["startMs"]
        ) / 1000.0
        predictions = to_events(candidate_id, artifact)
        for tolerance in [50.0, 25.0, 100.0]:
            score = score_take(synthetic_truth, predictions, duration_seconds, tolerance)
            metrics_rows.append({
                "candidateId": candidate_id,
                "takeId": take_id,
                "toleranceMs": tolerance,
                **{key: value for key, value in score.items() if key != "matching"},
                "matchCount": len(score["matching"]["matches"]),
            })

    primary_rows = [row for row in metrics_rows if row["toleranceMs"] == 50.0]
    pairwise = {}
    for left, right in [
        ("robust-browser-v1", "online-amt-k8-browser-v1"),
        ("robust-browser-v1", "basic-pitch-browser-v1"),
        ("online-amt-k8-browser-v1", "basic-pitch-browser-v1"),
    ]:
        for metric in ["f1", "falsePositiveOnsetsPerMinute", "missedOnsetRate"]:
            pairwise[f"{left}__{right}__{metric}"] = paired_bootstrap(primary_rows, left, right, metric, draws=100, seed=13371)
            pairwise[f"{right}__{left}__{metric}"] = paired_bootstrap(primary_rows, right, left, metric, draws=100, seed=13371)
    candidate_metrics = {
        candidate: {
            "completeCoverage": True,
            **runtime_eligibility(candidate, processing_p95_ms=1.0, sustained_backlog=False),
        }
        for candidate in CANDIDATES
    }
    disposition = decide_front_runner(candidate_metrics, pairwise)
    report = {
        "phase": PHASE,
        "artifact": "phase9g_xc1_r3c_true_complete_pipeline_dry_run",
        "acceptanceInput": str((REPO_ROOT / "backend/data/work/xc1_r3c/phase9g_xc1_r3c_semantic_executor_acceptance_2026-10-14.json").relative_to(REPO_ROOT)).replace("\\", "/"),
        "stageASealManifest": str(seal_path.relative_to(REPO_ROOT)).replace("\\", "/"),
        "sealVerification": seal_verification,
        "sealMutationProof": mutation,
        "truthRevealTimestamp": truth_reveal_timestamp,
        "syntheticTruthOnly": True,
        "metrics50ms": primary_rows,
        "metrics25ms": [row for row in metrics_rows if row["toleranceMs"] == 25.0],
        "metrics100ms": [row for row in metrics_rows if row["toleranceMs"] == 100.0],
        "pairedBootstrap": pairwise,
        "frontRunnerDryRunDisposition": disposition,
        "overallStatus": "TRUE_COMPLETE_SEALED_PIPELINE_DRY_RUN_PASS",
    }
    write_json(output, report)
    print(json.dumps({"output": str(output), "overallStatus": report["overallStatus"]}, indent=2))


if __name__ == "__main__":
    main()
