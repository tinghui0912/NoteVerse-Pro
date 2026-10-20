from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
import sys
import wave
import zipfile
from io import BytesIO
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[3]
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))

from backend.research.xc1_scientific_bakeoff import (
    SMD_ARCHIVE_BYTES,
    SMD_ARCHIVE_MD5,
    SMD_ARCHIVE_NAME,
    SMD_RESOLVED_VERSION_DOI,
    SMD_RESOLVER_DOI,
    canonical_json_sha256,
    common_scoreable_interval_ms,
    inventory_archive,
    md5_file,
    pair_smd_audio_midi,
    select_edge_subset,
    sha256_file,
)


REPORTS = REPO_ROOT / "backend" / "research" / "reports"
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
    actual_bytes = archive.stat().st_size
    actual_md5 = md5_file(archive)
    actual_sha256 = sha256_file(archive)
    if actual_bytes != SMD_ARCHIVE_BYTES or actual_md5 != SMD_ARCHIVE_MD5:
        raise SystemExit(
            "XC1_BLOCKED_DATASET_ACQUISITION:identity_mismatch:"
            f"bytes={actual_bytes}:md5={actual_md5}"
        )
    return {
        "archivePath": rel(archive),
        "archiveName": SMD_ARCHIVE_NAME,
        "resolverDoi": SMD_RESOLVER_DOI,
        "resolvedVersionDoi": SMD_RESOLVED_VERSION_DOI,
        "expectedBytes": SMD_ARCHIVE_BYTES,
        "actualBytes": actual_bytes,
        "expectedMd5": SMD_ARCHIVE_MD5,
        "actualMd5": actual_md5,
        "sha256": actual_sha256,
        "verificationStatus": "PASS",
    }


def basic_pitch_assets() -> dict[str, Any]:
    package_lock = BASIC_PITCH_WORK / "package-lock.json"
    package_json = BASIC_PITCH_WORK / "node_modules" / "@spotify" / "basic-pitch" / "package.json"
    tfjs_json = BASIC_PITCH_WORK / "node_modules" / "@tensorflow" / "tfjs" / "package.json"
    model_json = BASIC_PITCH_WORK / "node_modules" / "@spotify" / "basic-pitch" / "model" / "model.json"
    weights = BASIC_PITCH_WORK / "node_modules" / "@spotify" / "basic-pitch" / "model" / "group1-shard1of1.bin"
    package = read_json(package_json)
    tfjs = read_json(tfjs_json)
    assets = {
        "package": "@spotify/basic-pitch",
        "packageVersion": package["version"],
        "packageLockSha256": sha256_file(package_lock),
        "modelJsonSha256": sha256_file(model_json),
        "modelJsonBytes": model_json.stat().st_size,
        "weightsSha256": sha256_file(weights),
        "weightsBytes": weights.stat().st_size,
        "tfjsVersion": tfjs["version"],
        "browserBackend": "tensorflowjs-webgl",
        "onsetThreshold": 0.5,
        "frameThreshold": 0.3,
        "minNoteLenFrames": 5,
        "inferOnsets": True,
        "melodiaTrick": True,
        "energyTolerance": 11,
        "pitchRange": [21, 108],
        "timeMapping": "@spotify/basic-pitch@1.0.1::noteFramesToTime",
        "decoder": "@spotify/basic-pitch@1.0.1::outputToNotesPoly",
        "ownershipFiltering": "noteverse-common-half-open-acoustic-ownership-v1",
        "decoderSourceSha256": source_sha("apps/customer-web/src/lib/practice/research/xc1-acoustic-candidates.ts"),
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


def archive_file_sha256(zf: zipfile.ZipFile, name: str) -> str:
    digest = hashlib.sha256()
    with zf.open(name) as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


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


def build_take_manifest(archive: Path) -> dict[str, Any]:
    inventory = inventory_archive(archive)
    paired = pair_smd_audio_midi(inventory["files"])
    takes = []
    excluded = list(paired["excluded"])
    with zipfile.ZipFile(archive) as zf:
        for pair in paired["pairs"]:
            wav_path = pair["acousticWav"]["relativePath"]
            midi_path = pair["midi"]["relativePath"]
            wav_meta = wav_metadata_from_zip(zf, wav_path)
            duration_ms = wav_meta["audioDurationSeconds"] * 1000
            scoreable = common_scoreable_interval_ms(duration_ms)
            takes.append({
                "takeId": pair["takeId"],
                "pieceId": pair["pieceId"],
                "performerId": pair["performerId"],
                "recordingSourceId": "smd-v2-real-acoustic-wav",
                "acousticWavRelativePath": wav_path,
                "acousticWavBytes": pair["acousticWav"]["bytes"],
                "acousticWavSha256": archive_file_sha256(zf, wav_path),
                "midiRelativePath": midi_path,
                "midiBytes": pair["midi"]["bytes"],
                "midiSha256": archive_file_sha256(zf, midi_path),
                **wav_meta,
                "midiDurationSeconds": "TO_BE_COMPUTED_BY_STAGE_B_MIDI_READER",
                "canonicalPcm": {
                    "preprocessing": "deterministic_wav_pcm16_stereo_mean_linear_resample_16k_v1",
                    "sampleRateHz": 16000,
                    "canonicalPcmSampleCount": int(wav_meta["audioDurationSeconds"] * 16000),
                    "identityDeferredUntilStageAExtraction": True,
                },
                "scoreableInterior": scoreable,
            })
    manifest = {
        "schemaVersion": 1,
        "datasetId": "smd-midi-audio-piano-music-v2",
        "resolverDoi": SMD_RESOLVER_DOI,
        "resolvedVersionDoi": SMD_RESOLVED_VERSION_DOI,
        "archiveInventory": {
            "fileCount": inventory["fileCount"],
            "categories": inventory["categories"],
        },
        "takeCount": len(takes),
        "takes": sorted(takes, key=lambda take: take["takeId"]),
        "excluded": excluded,
        "edgeParitySubsetTakeIds": select_edge_subset(takes),
        "forbiddenAudioSource": "midi_wav_22050_mono",
        "allCandidateInferencePending": True,
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
    args = parser.parse_args()
    implementation_head = current_git_head()
    archive = require_archive(args.archive)
    take_manifest = build_take_manifest(args.archive)
    basic_pitch = basic_pitch_assets()
    source_hashes = {
        "candidateRegistry": source_sha("apps/customer-web/src/lib/practice/research/xc1-acoustic-candidates.ts"),
        "greenfieldBoundary": source_sha("apps/customer-web/src/lib/practice/research/acoustic-candidate-contract.ts"),
        "commonPcmPreprocessing": source_sha("backend/research/xc1_scientific_bakeoff.py"),
        "smdManifestGenerator": source_sha("backend/research/tools/freeze_phase9g_xc1_r1_true_freeze.py"),
        "matchingScorer": source_sha("backend/research/xc1_scientific_bakeoff.py"),
        "metrics": source_sha("backend/research/xc1_scientific_bakeoff.py"),
        "bootstrap": source_sha("backend/research/xc1_scientific_bakeoff.py"),
        "frontRunnerDecision": source_sha("backend/research/xc1_scientific_bakeoff.py"),
    }
    candidate_identity = {
        "phase": "PHASE_9G_XC1_R1_EXECUTABLE_CANDIDATE_WIRING_TRUE_SMD_FREEZE_AND_FULL_SCIENTIFIC_BAKEOFF",
        "artifact": "candidateIdentityFreezeF2",
        "date": "2026-10-14",
        "startingRemoteHead": args.starting_head,
        "implementationGitHead": implementation_head,
        "prefreezeF0Commit": "6cf639a85de830707bf80883f675ee8c3bd76464",
        "prefreezeF0Classification": "XC1_PROTOCOL_PREFREEZE_F0",
        "basicPitchBrowserV1": basic_pitch,
        "robustBrowserV1": {
            "deploymentId": "robust-browser-v1",
            "deploymentIdentitySha256": "196a9a2ceb03569f6e266c4f5973125bb8596146882079105ee94ef7e621deed",
            "onnxSha256": "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3",
        },
        "onlineAmtK8BrowserV1": {
            "deploymentId": "online-amt-k8-browser-v1",
            "k8OnnxSha256": "818c095a3e96f507f45fe5f394169660cb3848fb7e496699a99c1957b51e9f18",
            "k1FallbackOnnxSha256": "1924789c64595a5b8c1ff2f745089613b2ba6108676952c4bb6f60f28d9cd301",
            "configurationSha256": "0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375",
            "checkpointSha256": "54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0",
        },
    }
    candidate_identity["candidateIdentityFreezeSha256"] = canonical_json_sha256(candidate_identity)
    scoring_policy = {
        "phase": candidate_identity["phase"],
        "artifact": "scoringPolicyFreezeF2",
        "primaryToleranceMs": 50,
        "sensitivityTolerancesMs": [25, 100],
        "matching": "pitch-aware one-to-one max-cardinality min-total-error deterministic tie-break",
        "metrics": [
            "precision",
            "recall",
            "f1",
            "falsePositiveOnsetsPerMinute",
            "missedOnsetRate",
            "onsetAbsTimingMedianMs",
            "onsetAbsTimingP95Ms",
            "duplicateRetriggerFalseDetections",
            "chordNoteCompletenessDiagnostic",
        ],
        "bootstrap": {"unit": "performance_take", "draws": 5000, "seed": 13371},
        "frontRunnerPolicy": "runtime eligible + complete coverage + F1 CI above 0 versus both + no FP/min or missed-rate CI regression",
        "runtimeEligibility": {
            "robustAndBasicPitchP95ProcessingMsMax": 480,
            "onlineAmtK8P95GroupedProcessingMsMax": 204.8,
            "requiresNoSustainedBacklog": True,
        },
    }
    scoring_policy["scoringPolicySha256"] = canonical_json_sha256(scoring_policy)
    freeze = {
        "phase": candidate_identity["phase"],
        "artifact": "trueProspectiveFreezeReceiptF2",
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
        "scopeProtections": {
            "phase9gBOutcome": "STATISTICAL_TIE",
            "phase9gBWinner": None,
            "p15p22InferenceIncrease": 0,
            "productionMicrophoneEnabled": False,
            "practiceWebSocketRestored": False,
            "backendPracticeInferenceRestored": False,
            "d4QualificationPerformed": False,
            "productionWinnerSelected": False,
        },
    }
    freeze["trueProspectiveFreezeSha256"] = canonical_json_sha256(freeze)
    write_report("phase9g_xc1_r1_candidate_identity_freeze_2026-10-14.json", candidate_identity)
    write_report("phase9g_xc1_r1_smd_take_manifest_2026-10-14.json", take_manifest)
    write_report("phase9g_xc1_r1_scoring_policy_freeze_2026-10-14.json", scoring_policy)
    write_report("phase9g_xc1_r1_edge_subset_freeze_2026-10-14.json", {
        "phase": candidate_identity["phase"],
        "artifact": "edgeSubsetFreezeF2",
        "takeIds": take_manifest["edgeParitySubsetTakeIds"],
        "selectionAlgorithm": "deterministic sorted performerId/pieceId/takeId stride over manifest before inference",
        "takeManifestSha256": take_manifest["manifestSha256"],
    })
    write_report("phase9g_xc1_r1_true_prospective_freeze_receipt_2026-10-14.json", freeze)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
