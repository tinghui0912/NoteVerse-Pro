from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import wave
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[2]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.research.xc1_scientific_bakeoff import (
    CANONICAL_PCM_IDENTITY,
    SMD_ARCHIVE_BYTES,
    SMD_ARCHIVE_MD5,
    SMD_ARCHIVE_NAME,
    SMD_ARCHIVE_SHA256,
    SMD_RESOLVED_VERSION_DOI,
    SMD_RESOLVER_DOI,
    archive_file_sha256,
    archive_role_inventory,
    bytedance_linear_resample_full_np,
    canonical_json_sha256,
    common_scoreable_interval_ms,
    infer_performer_id,
    infer_piece_id,
    inventory_archive,
    md5_file,
    pair_smd_audio_midi,
    read_pcm16_wav_mono_float32_np,
    select_edge_subset,
    sha256_file,
)

REPORTS = REPO_ROOT / "backend" / "research" / "reports"
WORK = REPO_ROOT / "backend" / "data" / "work" / "xc1_r2"
BASIC_PITCH_WORK = REPO_ROOT / "backend" / "data" / "work" / "basic_pitch_browser_feasibility"


def rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def current_git_head() -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, text=True).strip()


def source_sha(path: str) -> str:
    return sha256_file(REPO_ROOT / path)


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def require_archive(archive: Path) -> dict[str, Any]:
    if not archive.exists():
        raise SystemExit(f"XC1_BLOCKED_DATASET_ACQUISITION:missing:{archive}")
    actual = {
        "bytes": archive.stat().st_size,
        "md5": md5_file(archive),
        "sha256": sha256_file(archive),
    }
    if actual["bytes"] != SMD_ARCHIVE_BYTES or actual["md5"] != SMD_ARCHIVE_MD5 or actual["sha256"] != SMD_ARCHIVE_SHA256:
        raise SystemExit(f"XC1_BLOCKED_DATASET_ACQUISITION:identity_mismatch:{json.dumps(actual, sort_keys=True)}")
    return {
        "archiveName": SMD_ARCHIVE_NAME,
        "archivePath": rel(archive),
        "resolverDoi": SMD_RESOLVER_DOI,
        "resolvedVersionDoi": SMD_RESOLVED_VERSION_DOI,
        "expectedBytes": SMD_ARCHIVE_BYTES,
        "actualBytes": actual["bytes"],
        "expectedMd5": SMD_ARCHIVE_MD5,
        "actualMd5": actual["md5"],
        "expectedSha256": SMD_ARCHIVE_SHA256,
        "actualSha256": actual["sha256"],
        "verificationStatus": "PASS",
    }


def basic_pitch_assets() -> dict[str, Any]:
    package_lock = BASIC_PITCH_WORK / "package-lock.json"
    package_json = BASIC_PITCH_WORK / "node_modules" / "@spotify" / "basic-pitch" / "package.json"
    tfjs_json = BASIC_PITCH_WORK / "node_modules" / "@tensorflow" / "tfjs" / "package.json"
    model_json = BASIC_PITCH_WORK / "node_modules" / "@spotify" / "basic-pitch" / "model" / "model.json"
    weights = BASIC_PITCH_WORK / "node_modules" / "@spotify" / "basic-pitch" / "model" / "group1-shard1of1.bin"
    decoder_source = BASIC_PITCH_WORK / "node_modules" / "@spotify" / "basic-pitch" / "esm" / "toMidi.js"
    package = read_json(package_json)
    tfjs = read_json(tfjs_json)
    assets = {
        "deploymentId": "basic-pitch-browser-v1",
        "package": "@spotify/basic-pitch",
        "packageVersion": package["version"],
        "packageLockSha256": sha256_file(package_lock),
        "modelJsonSha256": sha256_file(model_json),
        "modelJsonBytes": model_json.stat().st_size,
        "weightsSha256": sha256_file(weights),
        "weightsBytes": weights.stat().st_size,
        "tfjsVersion": tfjs["version"],
        "browserBackend": "tensorflowjs-webgl",
        "officialDecoderImportPath": "node_modules/@spotify/basic-pitch/esm/index.js",
        "officialDecoderSourceSha256": sha256_file(decoder_source),
        "onsetThreshold": 0.5,
        "frameThreshold": 0.3,
        "minNoteLenFrames": 5,
        "inferOnsets": True,
        "melodiaTrick": True,
        "energyTolerance": 11,
        "pitchRange": [21, 108],
        "resamplerIdentity": "noteverse-basic-pitch-deterministic-linear-16k-to-22050-v1",
        "ownershipFilteringIdentity": "noteverse-common-half-open-acoustic-ownership-v1",
    }
    expected = {
        "packageVersion": "1.0.1",
        "packageLockSha256": "20411bed571869711745c3ad993847a67512bb59156df5e16a372cccb1c9d4e8",
        "modelJsonSha256": "1ed1aaee3409ec1dc098c8b01f430c0911f6fe9412e7af8086750f9e8f302f68",
        "weightsSha256": "b142a95737a52e1e412d5f92e73d8bb80dfe8d04941acc0702f11f4524fb377c",
        "tfjsVersion": "3.21.0",
    }
    drift = {key: {"expected": value, "actual": assets[key]} for key, value in expected.items() if assets[key] != value}
    if drift:
        raise SystemExit(f"XC1_CANDIDATE_ASSET_IDENTITY_DRIFT:{json.dumps(drift, sort_keys=True)}")
    assets["deploymentIdentitySha256"] = canonical_json_sha256(assets)
    return assets


def wav_metadata_from_zip(zf: zipfile.ZipFile, name: str) -> dict[str, Any]:
    with zf.open(name) as handle:
        data = handle.read()
    with wave.open(BytesIO(data), "rb") as wav:
        frames = wav.getnframes()
        sample_rate = wav.getframerate()
        channels = wav.getnchannels()
    return {
        "nativeSampleRateHz": sample_rate,
        "channelCount": channels,
        "audioDurationSeconds": frames / sample_rate if sample_rate else 0,
        "nativeFrameCount": frames,
    }


def canonicalize_zip_wav(zf: zipfile.ZipFile, wav_name: str, output_path: Path) -> dict[str, Any]:
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix="xc1_r2_wav_") as tmp:
        tmp_wav = Path(tmp) / Path(wav_name).name
        with zf.open(wav_name) as source, tmp_wav.open("wb") as dest:
            shutil.copyfileobj(source, dest)
        mono, sample_rate, channels = read_pcm16_wav_mono_float32_np(tmp_wav)
    pcm = bytedance_linear_resample_full_np(mono, sample_rate, 16_000)
    pcm.astype("<f4", copy=False).tofile(output_path)
    return {
        "relativeStageAPath": rel(output_path),
        "byteSize": output_path.stat().st_size,
        "sampleCount": int(pcm.shape[0]),
        "sha256": sha256_file(output_path),
        "sampleRateHz": 16000,
        "dtype": "float32-le-raw",
        "preprocessingIdentity": CANONICAL_PCM_IDENTITY,
        "sourceSampleRateHz": sample_rate,
        "sourceChannelCount": channels,
    }


def build_take_manifest(archive: Path, canonical_dir: Path) -> dict[str, Any]:
    inventory = inventory_archive(archive)
    roles = archive_role_inventory(inventory)
    paired = pair_smd_audio_midi(inventory["files"])
    takes = []
    with zipfile.ZipFile(archive) as zf:
        for pair in paired["pairs"]:
            wav_path = pair["acousticWav"]["relativePath"]
            midi_path = pair["midi"]["relativePath"]
            wav_meta = wav_metadata_from_zip(zf, wav_path)
            duration_ms = wav_meta["audioDurationSeconds"] * 1000
            take_id = pair["takeId"]
            canonical_path = canonical_dir / f"{take_id}.f32"
            canonical = canonicalize_zip_wav(zf, wav_path, canonical_path)
            takes.append({
                "takeId": take_id,
                "workId": infer_piece_id(take_id),
                "pieceClusterId": infer_piece_id(take_id),
                "performerId": infer_performer_id(take_id),
                "performerClusteringStatus": "PERFORMER_CLUSTERING_UNAVAILABLE_FROM_VERIFIED_METADATA",
                "recordingSourceId": "smd-v2-real-acoustic-wav-44100-stereo",
                "acousticWavRelativePath": wav_path,
                "acousticWavBytes": pair["acousticWav"]["bytes"],
                "acousticWavSha256": archive_file_sha256(zf, wav_path),
                "midiRelativePath": midi_path,
                "midiBytes": pair["midi"]["bytes"],
                "midiSha256": archive_file_sha256(zf, midi_path),
                **wav_meta,
                "canonicalPcm": canonical,
                "scoreableInterior": common_scoreable_interval_ms(duration_ms),
            })
    manifest = {
        "schemaVersion": 2,
        "datasetId": "smd-midi-audio-piano-music-v2",
        "resolverDoi": SMD_RESOLVER_DOI,
        "resolvedVersionDoi": SMD_RESOLVED_VERSION_DOI,
        "archiveRoleInventory": roles,
        "takeCount": len(takes),
        "takes": sorted(takes, key=lambda take: take["takeId"]),
        "excluded": paired["excluded"],
        "metadataClusteringStatus": {
            "performer": "PERFORMER_CLUSTERING_UNAVAILABLE_FROM_VERIFIED_METADATA",
            "pieceCluster": "FILENAME_WORK_PREFIX_CLUSTER_FROZEN",
            "bootstrapResamplingUnit": "pieceClusterId_if_repeated_else_performance_take",
        },
        "edgeParitySubsetTakeIds": select_edge_subset(takes),
        "forbiddenAudioSource": "midi_wav_22050_mono",
        "candidateInferenceStarted": False,
    }
    manifest["manifestSha256"] = canonical_json_sha256(manifest)
    return manifest


def write_report(name: str, payload: dict[str, Any]) -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / name).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--starting-head", required=True)
    parser.add_argument("--archive", required=True, type=Path)
    parser.add_argument("--canonical-dir", type=Path, default=WORK / "canonical_pcm")
    args = parser.parse_args()
    implementation_head = current_git_head()
    archive = require_archive(args.archive)
    take_manifest = build_take_manifest(args.archive, args.canonical_dir)
    basic_pitch = basic_pitch_assets()
    source_hashes = {
        "greenfieldBoundary": source_sha("apps/customer-web/src/lib/practice/research/acoustic-candidate-contract.ts"),
        "typescriptCandidateRegistry": source_sha("apps/customer-web/src/lib/practice/research/xc1-acoustic-candidates.ts"),
        "officialStageARegistry": source_sha("backend/research/browser_runtime/xc1_stage_a_candidate_registry.mjs"),
        "officialStageARunner": source_sha("backend/research/browser_runtime/xc1_stage_a_runner.mjs"),
        "commonPcmPreprocessing": source_sha("backend/research/xc1_scientific_bakeoff.py"),
        "smdManifestGenerator": source_sha("backend/scripts/freeze_phase9g_xc1_r2_f3.py"),
        "matchingScorer": source_sha("backend/research/xc1_scientific_bakeoff.py"),
        "metrics": source_sha("backend/research/xc1_scientific_bakeoff.py"),
        "bootstrap": source_sha("backend/research/xc1_scientific_bakeoff.py"),
        "frontRunnerDecision": source_sha("backend/research/xc1_scientific_bakeoff.py"),
        "robustHarness": source_sha("backend/research/browser_runtime/bytedance_onnx_browser_harness.mjs"),
        "onlineAmtHarness": source_sha("backend/research/browser_runtime/online_amt_grouped_browser_harness_dr3.mjs"),
        "onlineAmtWorker": source_sha("backend/research/browser_runtime/online_amt_grouped_browser_worker_dr3.mjs"),
        "basicPitchHarness": source_sha("backend/research/browser_runtime/basic_pitch_browser_harness.mjs"),
    }
    candidate_identity = {
        "phase": "PHASE_9G_XC1_R2_EXECUTABLE_F3_AND_FULL_SEALED_SMD_BAKEOFF",
        "artifact": "candidateIdentityFreezeF3",
        "date": "2026-10-14",
        "startingRemoteHead": args.starting_head,
        "implementationGitHead": implementation_head,
        "f2Reclassification": {
            "commit": "b1babb2ab99fab93f2ffefc0e7e7b2aa09326fb6",
            "classification": "XC1_DATASET_AND_POLICY_FREEZE_F2_NOT_EXECUTABLE",
            "reason": "dataset/policy identity was prospectively frozen, but actual executable browser candidate registry, Stage-A runner/sealing, canonical PCM byte identities, and Stage-B truth runner were not frozen",
            "smdCandidateInferenceBeforeCorrection": False,
        },
        "robustBrowserV1": {
            "deploymentId": "robust-browser-v1",
            "deploymentIdentitySha256": "196a9a2ceb03569f6e266c4f5973125bb8596146882079105ee94ef7e621deed",
            "onnxSha256": "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3",
            "onsetThreshold": 0.30,
            "frameThreshold": 0.05,
            "context": {"pastMs": 1000, "ownedMs": 600, "futureMs": 220, "inputSamples": 29120},
        },
        "onlineAmtK8BrowserV1": {
            "deploymentId": "online-amt-k8-browser-v1",
            "k8OnnxSha256": "818c095a3e96f507f45fe5f394169660cb3848fb7e496699a99c1957b51e9f18",
            "k1FallbackOnnxSha256": "1924789c64595a5b8c1ff2f745089613b2ba6108676952c4bb6f60f28d9cd301",
            "configurationSha256": "0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375",
            "checkpointSha256": "54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0",
            "hopSamples": 512,
            "groupHops": 8,
            "timingCorrectionMs": -162.93750000004252,
            "pseudoIntensity": "NATIVE",
        },
        "basicPitchBrowserV1": basic_pitch,
    }
    candidate_identity["candidateIdentityFreezeSha256"] = canonical_json_sha256(candidate_identity)
    scoring_policy = {
        "phase": candidate_identity["phase"],
        "artifact": "scoringPolicyFreezeF3",
        "primaryToleranceMs": 50,
        "sensitivityTolerancesMs": [25, 100],
        "matching": "pitch-aware one-to-one max-cardinality min-total-error deterministic tie-break",
        "scoreableInterior": "[1000ms, audioDuration-220ms)",
        "falsePositiveDenominator": "scoreable-interior-duration-minutes",
        "duplicateRetriggerDiagnostic": "unmatched same-pitch prediction within 50ms of matched prediction",
        "chordCompletenessDiagnostic": "NOT_AVAILABLE_IN_XC1_R2",
        "bootstrap": {"unit": "performance_take_or_verified_piece_cluster", "draws": 5000, "seed": 13371},
        "frontRunnerPolicy": "runtime eligible + complete coverage + F1 CI above 0 versus both + no FP/min or missed-rate CI regression",
    }
    scoring_policy["scoringPolicySha256"] = canonical_json_sha256(scoring_policy)
    freeze = {
        "phase": candidate_identity["phase"],
        "artifact": "trueExecutableProspectiveFreezeReceiptF3",
        "date": "2026-10-14",
        "startingRemoteHead": args.starting_head,
        "implementationGitHead": implementation_head,
        "archiveIdentity": archive,
        "takeManifestSha256": take_manifest["manifestSha256"],
        "candidateIdentityFreezeSha256": candidate_identity["candidateIdentityFreezeSha256"],
        "scoringPolicySha256": scoring_policy["scoringPolicySha256"],
        "sourceHashes": source_hashes,
        "candidateInferenceStarted": False,
        "stageATruthIsolationRequired": True,
        "canonicalPcmIdentityDeferred": False,
        "scopeProtections": {
            "phase9gBOutcome": "STATISTICAL_TIE",
            "phase9gBWinner": None,
            "p15p22InferenceIncrease": 0,
            "productionMicrophoneEnabled": False,
            "practiceWebSocketRestored": False,
            "backendPracticeInferenceRestored": False,
            "serverAcousticInferenceRestored": False,
            "d4QualificationPerformed": False,
            "productionWinnerSelected": False,
        },
    }
    freeze["trueExecutableProspectiveFreezeSha256"] = canonical_json_sha256(freeze)
    write_report("phase9g_xc1_r2_candidate_identity_freeze_f3_2026-10-14.json", candidate_identity)
    write_report("phase9g_xc1_r2_smd_take_manifest_f3_2026-10-14.json", take_manifest)
    write_report("phase9g_xc1_r2_scoring_policy_freeze_f3_2026-10-14.json", scoring_policy)
    write_report("phase9g_xc1_r2_edge_subset_freeze_f3_2026-10-14.json", {
        "phase": candidate_identity["phase"],
        "artifact": "edgeSubsetFreezeF3",
        "takeIds": take_manifest["edgeParitySubsetTakeIds"],
        "selectionAlgorithm": "deterministic sorted performerId/pieceId/takeId stride over corrected manifest before inference",
        "takeManifestSha256": take_manifest["manifestSha256"],
    })
    write_report("phase9g_xc1_r2_true_executable_freeze_receipt_f3_2026-10-14.json", freeze)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
