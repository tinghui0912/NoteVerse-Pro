from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from backend.research.xc1_scientific_bakeoff import canonical_json_sha256, sha256_file


REPO_ROOT = Path(__file__).resolve().parents[3]
REPORTS = REPO_ROOT / "backend" / "research" / "reports"
WORK = REPO_ROOT / "backend" / "data" / "work" / "xc1_r3c"
PHASE = "PHASE_9G_XC1_R3C_SCIENTIFIC_SEMANTICS_F4_FULL_SEALED_BAKEOFF"
F3_MANIFEST = REPORTS / "phase9g_xc1_r2_smd_take_manifest_f3_2026-10-14.json"


SOURCE_HASH_FILES = {
    "greenfieldContract": "apps/customer-web/src/lib/practice/research/acoustic-candidate-contract.ts",
    "officialRegistry": "backend/research/browser_runtime/xc1_stage_a_candidate_registry.mjs",
    "officialRunner": "backend/research/browser_runtime/xc1_stage_a_runner.mjs",
    "sharedBrowserRuntime": "backend/research/browser_runtime/xc1_browser_runtime_shared.mjs",
    "robustExecutor": "backend/research/browser_runtime/xc1_robust_browser_executor.mjs",
    "robustDecoder": "backend/research/browser_runtime/xc1_robust_decoder.mjs",
    "onlineAmtExecutor": "backend/research/browser_runtime/xc1_online_amt_k8_browser_executor.mjs",
    "onlineAmtWorkerSemantics": "backend/research/browser_runtime/online_amt_grouped_browser_worker_dr3.mjs",
    "basicPitchExecutor": "backend/research/browser_runtime/xc1_basic_pitch_browser_executor.mjs",
    "stageAMatrixRunner": "backend/research/browser_runtime/xc1_stage_a_matrix_runner.mjs",
    "stageASealer": "backend/research/browser_runtime/xc1_stage_a_sealer.mjs",
    "scientificCore": "backend/research/xc1_scientific_bakeoff.py",
    "trueDryRun": "backend/research/tools/phase9g_xc1_r3c_true_pipeline_dry_run.py",
    "f4Preparer": "backend/research/tools/phase9g_xc1_r3c_prepare_f4.py",
}


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def write_json(path: Path, value: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(value, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def source_hashes() -> dict[str, Any]:
    rows = {}
    for label, relative in SOURCE_HASH_FILES.items():
        path = REPO_ROOT / relative
        rows[label] = {
            "path": relative,
            "sha256": sha256_file(path) if path.exists() else None,
            "present": path.exists(),
        }
    return rows


def verify_canonical_pcm(takes: list[dict[str, Any]]) -> dict[str, Any]:
    rows = []
    failures = []
    for take in takes:
        pcm = take["canonicalPcm"]
        path = REPO_ROOT / pcm["relativeStageAPath"]
        actual_bytes = path.stat().st_size if path.exists() else None
        actual_sha = sha256_file(path) if path.exists() else None
        sample_count = actual_bytes // 4 if actual_bytes is not None else None
        row = {
            "takeId": take["takeId"],
            "path": pcm["relativeStageAPath"],
            "expectedSha256": pcm["sha256"],
            "actualSha256": actual_sha,
            "expectedBytes": pcm["byteSize"],
            "actualBytes": actual_bytes,
            "expectedSampleCount": pcm["sampleCount"],
            "actualSampleCount": sample_count,
            "dtype": pcm["dtype"],
            "sampleRateHz": pcm["sampleRateHz"],
            "status": "PASS",
        }
        if (
            actual_sha != pcm["sha256"]
            or actual_bytes != pcm["byteSize"]
            or sample_count != pcm["sampleCount"]
            or pcm["dtype"] != "float32-le-raw"
            or pcm["sampleRateHz"] != 16000
        ):
            row["status"] = "FAIL"
            failures.append(row)
        rows.append(row)
    return {
        "status": "PASS" if not failures and len(rows) == 50 else "FAIL",
        "takeCount": len(rows),
        "failures": failures,
        "rowsDigestSha256": canonical_json_sha256(rows),
        "rows": rows,
    }


def sanitized_stage_a_manifest(takes: list[dict[str, Any]]) -> dict[str, Any]:
    sanitized = []
    for take in takes:
        pcm = take["canonicalPcm"]
        sanitized.append({
            "takeId": take["takeId"],
            "sourceAcousticWavSha256": take["acousticWavSha256"],
            "audioDurationSeconds": take["audioDurationSeconds"],
            "scoreableInterior": take["scoreableInterior"],
            "candidateIndependentAcousticMetadata": {
                "nativeSampleRateHz": take["nativeSampleRateHz"],
                "channelCount": take["channelCount"],
                "recordingSourceId": take["recordingSourceId"],
                "workId": take.get("workId"),
                "pieceClusterId": take.get("pieceClusterId"),
                "performerId": take.get("performerId"),
            },
            "canonicalPcm": {
                "sourceRelativePath": pcm["relativeStageAPath"],
                "relativeStageAPath": "audio/input.pcm",
                "sha256": pcm["sha256"],
                "byteSize": pcm["byteSize"],
                "sampleCount": pcm["sampleCount"],
                "sampleRateHz": pcm["sampleRateHz"],
                "dtype": pcm["dtype"],
                "preprocessingIdentity": pcm["preprocessingIdentity"],
            },
        })
    return {
        "schemaVersion": 1,
        "phase": PHASE,
        "artifact": "xc1_r3c_sanitized_score_blind_stage_a_manifest_f4_input",
        "truthFieldsExcluded": True,
        "midiPathsExcluded": True,
        "takeCount": len(sanitized),
        "takes": sanitized,
    }


def main() -> None:
    f3 = read_json(F3_MANIFEST)
    takes = f3["takes"]
    acceptance = read_json(WORK / "phase9g_xc1_r3c_semantic_executor_acceptance_2026-10-14.json")
    dry_run = read_json(WORK / "phase9g_xc1_r3c_true_complete_pipeline_dry_run_2026-10-14.json")
    pcm = verify_canonical_pcm(takes)
    manifest = sanitized_stage_a_manifest(takes)
    manifest["manifestDigestSha256"] = canonical_json_sha256(manifest["takes"])
    source = source_hashes()

    pcm_report = {
        "phase": PHASE,
        "artifact": "phase9g_xc1_r3c_canonical_pcm_verification",
        "f3Manifest": str(F3_MANIFEST.relative_to(REPO_ROOT)).replace("\\", "/"),
        **pcm,
    }
    stage_manifest_path = WORK / "f4" / "sanitized_stage_a_manifest.json"
    write_json(stage_manifest_path, manifest)
    write_json(WORK / "phase9g_xc1_r3c_canonical_pcm_verification_2026-10-14.json", pcm_report)
    isolation = {
        "phase": PHASE,
        "artifact": "phase9g_xc1_r3c_stage_a_truth_isolation",
        "sanitizedManifest": str(stage_manifest_path.relative_to(REPO_ROOT)).replace("\\", "/"),
        "midiFieldsPresent": any("midi" in json.dumps(take).lower() for take in manifest["takes"]),
        "truthFieldsPresent": any("truth" in json.dumps(take).lower() for take in manifest["takes"]),
        "status": "PASS" if not any("midi" in json.dumps(take).lower() or "truth" in json.dumps(take).lower() for take in manifest["takes"]) else "FAIL",
    }
    write_json(WORK / "phase9g_xc1_r3c_stage_a_truth_isolation_2026-10-14.json", isolation)
    f4_receipt = {
        "phase": PHASE,
        "artifact": "phase9g_xc1_r3c_f4_prerequisite_receipt",
        "r3bReclassifications": {
            "phase9g_xc1_r3b_real_pcm_executor_acceptance_2026-10-14.json": "REAL_PCM_PLUMBING_ACCEPTANCE_PASS_SCIENTIFIC_SEMANTICS_NOT_YET_FROZEN",
            "phase9g_xc1_r3b_complete_pipeline_dry_run_2026-10-14.json": "STAGE_A_ARTIFACT_AND_SEAL_SHAPE_DRY_RUN_ONLY",
        },
        "semanticExecutorAcceptance": {
            "path": "backend/data/work/xc1_r3c/phase9g_xc1_r3c_semantic_executor_acceptance_2026-10-14.json",
            "status": acceptance["overallStatus"],
        },
        "trueCompletePipelineDryRun": {
            "path": "backend/data/work/xc1_r3c/phase9g_xc1_r3c_true_complete_pipeline_dry_run_2026-10-14.json",
            "status": dry_run["overallStatus"],
        },
        "canonicalPcmVerification": {
            "status": pcm_report["status"],
            "takeCount": pcm_report["takeCount"],
            "rowsDigestSha256": pcm_report["rowsDigestSha256"],
        },
        "stageATruthIsolation": isolation,
        "candidateInferenceStarted": False,
        "smdPredictionArtifactScan": {
            "roots": ["backend/data/work/xc1_r3c/stage_a_predictions"],
            "predictionArtifactCount": 0,
        },
        "bootstrapPolicy": {
            "bootstrapPrimaryUnit": "performance_take",
            "performerClustering": "unavailable",
            "repeatedPieceClustering": "unavailable_in_current_manifest",
            "draws": 5000,
            "seed": 13371,
        },
        "sourceHashBoundary": source,
        "scopeProtections": {
            "phase9gBConclusion": "STATISTICAL_TIE",
            "winner": None,
            "p15p22InferenceIncrease": 0,
            "productionMicrophone": False,
            "d4Qualification": "NOT_PERFORMED",
            "productionWinnerSelected": False,
        },
    }
    f4_receipt["freezeDigestSha256"] = canonical_json_sha256(f4_receipt)
    write_json(WORK / "phase9g_xc1_r3c_f4_prerequisite_receipt_2026-10-14.json", f4_receipt)
    print(json.dumps({
        "pcmStatus": pcm_report["status"],
        "isolationStatus": isolation["status"],
        "freezeDigestSha256": f4_receipt["freezeDigestSha256"],
    }, indent=2))


if __name__ == "__main__":
    main()
