from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[2]
REPORTS = REPO_ROOT / "backend" / "research" / "reports"
BASIC_PITCH_WORK = REPO_ROOT / "backend" / "data" / "work" / "basic_pitch_browser_feasibility"


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
      for chunk in iter(lambda: handle.read(1024 * 1024), b""):
          digest.update(chunk)
    return digest.hexdigest()


def canonical_sha256(value: Any) -> str:
    payload = json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return hashlib.sha256(payload).hexdigest()


def maybe_file_identity(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {
            "path": rel(path),
            "available": False,
        }
    return {
        "path": rel(path),
        "available": True,
        "bytes": path.stat().st_size,
        "sha256": sha256_file(path),
    }


def rel(path: Path) -> str:
    try:
        return path.resolve().relative_to(REPO_ROOT.resolve()).as_posix()
    except ValueError:
        return path.as_posix()


def read_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def current_git_head() -> str:
    return subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=REPO_ROOT, text=True).strip()


def basic_pitch_identity() -> dict[str, Any]:
    package_dir = BASIC_PITCH_WORK / "node_modules" / "@spotify" / "basic-pitch"
    tfjs_package = BASIC_PITCH_WORK / "node_modules" / "@tensorflow" / "tfjs" / "package.json"
    package_lock = BASIC_PITCH_WORK / "package-lock.json"
    package_json = package_dir / "package.json"
    package = read_json(package_json) if package_json.exists() else {}
    tfjs = read_json(tfjs_package) if tfjs_package.exists() else {}

    return {
        "deploymentId": "basic-pitch-browser-v1",
        "packageName": "@spotify/basic-pitch",
        "packageVersion": package.get("version", "1.0.1"),
        "packageLicense": package.get("license", "Apache-2.0"),
        "packageLock": maybe_file_identity(package_lock),
        "modelJson": maybe_file_identity(package_dir / "model" / "model.json"),
        "weightsShard": maybe_file_identity(package_dir / "model" / "group1-shard1of1.bin"),
        "tensorflowJs": {
            "packageName": "@tensorflow/tfjs",
            "version": tfjs.get("version"),
            "packageJson": maybe_file_identity(tfjs_package),
        },
        "browserBackend": "tensorflowjs-webgl",
        "inputPreprocessing": {
            "commonInput": "canonical_16khz_mono_from_smd_official_wav",
            "basicPitchResampler": "noteverse-basic-pitch-deterministic-linear-16k-to-22050-v1",
            "sourceCandidateMayNotReceiveCleanerInput": True,
        },
        "decoder": {
            "decoderId": "noteverse-basic-pitch-all-pitch-continuous-decoder-v1",
            "onsetThreshold": 0.5,
            "frameThreshold": 0.3,
            "scoreBlind": True,
            "emitsAllPianoPitches": True,
            "historicalFixedAnchorStepVerifierEvidenceTransferred": False,
        },
    }


def robust_identity() -> dict[str, Any]:
    report = read_json(REPORTS / "phase9g_d3_robust_browser_v1_identity_2026-10-13.json")
    identity = dict(report["identity"])
    identity["deploymentIdentitySha256"] = report["deploymentIdentitySha256"]
    identity["historicalCudaMetricsTransferred"] = False
    identity["xc1RuntimeOrtWebVersion"] = "TO_BE_MEASURED_IN_XC1_BROWSER_RUN"
    identity["primaryMetricUsesBrowserDeploymentOnly"] = True
    return identity


def online_amt_identity() -> dict[str, Any]:
    correction = read_json(REPORTS / "phase9g_dr3r1h_c_evidence_correction_and_final_k8_disposition_2026-10-14.json")
    identity = {
        "deploymentId": "online-amt-k8-browser-v1",
        "sourceCandidateId": "online-amt-calibrated-v1",
        "configurationSha256": "0d56e238a353a0aecfbf1d129521e93fc69f7e171711ce9ad57b419548edc375",
        "checkpointSha256": "54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0",
        "k8OnnxSha256": "818c095a3e96f507f45fe5f394169660cb3848fb7e496699a99c1957b51e9f18",
        "k1ResidualFallbackOnnxSha256": "1924789c64595a5b8c1ff2f745089613b2ba6108676952c4bb6f60f28d9cd301",
        "hopSamples": 512,
        "hopMs": 32,
        "groupHops": 8,
        "groupMs": 256,
        "timingCorrectionMs": -162.93750000004252,
        "publishedOnsetBoost": 1.0,
        "pseudoIntensity": "NATIVE",
        "ortWebResearchRuntimeVersion": "1.30.0",
        "productionCustomerWebOrtVersion": "1.20.1",
        "eligibilitySource": rel(REPORTS / "phase9g_dr3r1h_c_evidence_correction_and_final_k8_disposition_2026-10-14.json"),
        "eligibilityDisposition": correction["finalOnlineAmtDisposition"],
        "knownEvidenceLimitations": [
            "Strict browser probabilities/confidence are non-bit-exact.",
            "Decision-semantic parity in DR3R1H-C is partly inferential from raw chosen-state parity plus deterministic bridge behavior.",
            "Dedicated gate test established K8-vs-K1 Worker consistency but was not a full independent Docker/Python recurrent-state trajectory comparison.",
        ],
    }
    identity["deploymentIdentitySha256"] = canonical_sha256(identity)
    return identity


def candidate_identity_freeze(starting_head: str) -> dict[str, Any]:
    implementation_head = current_git_head()
    identities = {
        "robust-browser-v1": robust_identity(),
        "online-amt-k8-browser-v1": online_amt_identity(),
        "basic-pitch-browser-v1": basic_pitch_identity(),
    }
    report = {
        "phase": "PHASE_9G_XC1_FRESH_EXTERNAL_THREE_CANDIDATE_SCIENTIFIC_BAKEOFF",
        "artifact": "candidateIdentityFreeze",
        "date": "2026-10-14",
        "startingRemoteHead": starting_head,
        "implementationGitHead": implementation_head,
        "greenfieldBoundary": "GREENFIELD_AUDIO_ONLY_ACOUSTIC_CONTRACT",
        "candidateInferenceStarted": False,
        "identities": identities,
    }
    report["candidateIdentityFreezeSha256"] = canonical_sha256(report)
    return report


def training_overlap_audit(starting_head: str) -> dict[str, Any]:
    implementation_head = current_git_head()
    sources = {
        "smdAudioLabs": {
            "url": "https://www.audiolabs-erlangen.de/resources/MIR/SMD/midi",
            "evidence": "SMD MIDI-Audio Piano Music Version 2; publisher recommends original WAV files from Zenodo; license CC BY-NC-SA 3.0.",
        },
        "smdZenodoDoi": {
            "url": "https://zenodo.org/doi/10.5281/zenodo.10847280",
            "doi": "10.5281/zenodo.10847280",
        },
        "basicPitchTrainingReadme": {
            "url": "https://github.com/spotify/basic-pitch/blob/main/basic_pitch/data/README.md",
            "declaredTrainingDatasetScripts": ["guitarset", "ikala", "maestro", "medleydb_pitch", "slakh"],
        },
        "basicPitchTrainCodeMirror": {
            "url": "https://d3axxy9bcycpv7.cloudfront.net/spotify/basic-pitch/src/main/basic_pitch/train.py.html",
            "declaredDatasetsToUseExamples": ["guitarset", "medleydb_pitch", "slakh"],
        },
    }
    candidates = {
        "robust-browser-v1": {
            "smdOverlapStatus": "NO_DOCUMENTED_OVERLAP",
            "basis": "Repository prior ByteDance audit lists published training declarations without SMD; not mathematical proof of disjointness.",
        },
        "online-amt-k8-browser-v1": {
            "smdOverlapStatus": "NO_DOCUMENTED_OVERLAP",
            "basis": "Repository prior Online-AMT audit lists published training declarations without SMD; not mathematical proof of disjointness.",
        },
        "basic-pitch-browser-v1": {
            "smdOverlapStatus": "NO_DOCUMENTED_OVERLAP",
            "basis": "Pinned Basic Pitch public training documentation inspected for this phase lists GuitarSet, iKala, MAESTRO, MedleyDB Pitch, and Slakh tooling; SMD was not documented.",
        },
    }
    report = {
        "phase": "PHASE_9G_XC1_FRESH_EXTERNAL_THREE_CANDIDATE_SCIENTIFIC_BAKEOFF",
        "artifact": "trainingOverlapAudit",
        "date": "2026-10-14",
        "startingRemoteHead": starting_head,
        "implementationGitHead": implementation_head,
        "primaryCorpus": "SMD MIDI-Audio Piano Music Version 2",
        "license": "CC BY-NC-SA 3.0",
        "commercialQualificationStatus": "NOT_PERFORMED",
        "scientificResearchOnly": True,
        "sources": sources,
        "candidateOverlapStatus": candidates,
        "knownOverlapDetected": False,
        "unknownOverlapRemaining": False,
        "candidateInferenceAllowedByOverlapAudit": True,
        "caution": "NO_DOCUMENTED_OVERLAP is an evidence status from published declarations inspected before inference, not a proof that data was never seen.",
    }
    report["trainingOverlapAuditSha256"] = canonical_sha256(report)
    return report


def smd_manifest_freeze(starting_head: str) -> dict[str, Any]:
    implementation_head = current_git_head()
    report = {
        "phase": "PHASE_9G_XC1_FRESH_EXTERNAL_THREE_CANDIDATE_SCIENTIFIC_BAKEOFF",
        "artifact": "smdDatasetIdentityAndManifestPrerequisite",
        "date": "2026-10-14",
        "startingRemoteHead": starting_head,
        "implementationGitHead": implementation_head,
        "dataset": {
            "datasetId": "smd-midi-audio-piano-music-v2",
            "canonicalName": "SMD MIDI-Audio Piano Music Version 2",
            "authoritativePage": "https://www.audiolabs-erlangen.de/resources/MIR/SMD/midi",
            "zenodoDoi": "10.5281/zenodo.10847280",
            "requiredAudioMaterial": "original WAV files from Zenodo, not MP3 previews",
            "license": "CC BY-NC-SA 3.0",
            "role": "SCIENTIFIC_RESEARCH_ONLY",
        },
        "takeManifestStatus": "NOT_ACQUIRED_YET",
        "takeManifestFreezeRequiredBeforeInference": True,
        "candidateIndependentInclusionPolicy": {
            "include": "all eligible SMD Version-2 WAV/MIDI pairs",
            "excludeOnlyFor": ["missing synchronized truth", "corrupt media", "unreadable source", "non-piano/non-target subset if identified by publisher metadata"],
            "forbiddenExclusionBasis": "candidate output or candidate-specific performance",
        },
        "rawDatasetRetentionPolicy": "Raw media may be deleted after hashes, sealed predictions, scoring reports, statistics, and evidence commit are safely preserved.",
        "candidateInferenceStarted": False,
    }
    report["smdDatasetPrerequisiteSha256"] = canonical_sha256(report)
    return report


def qualification_protocol(starting_head: str, identity_sha: str, overlap_sha: str, smd_sha: str) -> dict[str, Any]:
    implementation_head = current_git_head()
    report = {
        "phase": "PHASE_9G_XC1_FRESH_EXTERNAL_THREE_CANDIDATE_SCIENTIFIC_BAKEOFF",
        "artifact": "publicScientificLaneAProtocol",
        "date": "2026-10-14",
        "startingRemoteHead": starting_head,
        "implementationGitHead": implementation_head,
        "notD4": True,
        "commercialQualificationStatus": "NOT_PERFORMED",
        "productionWinnerSelection": "NOT_PERFORMED",
        "candidateIdentityFreezeSha256": identity_sha,
        "trainingOverlapAuditSha256": overlap_sha,
        "smdDatasetPrerequisiteSha256": smd_sha,
        "stageA": {
            "name": "sealed audio-only acoustic prediction",
            "modelInputsAllowed": ["canonical 16k mono PCM", "acoustic/runtime metadata"],
            "modelInputsForbidden": [
                "expected pitch",
                "expected strikes",
                "score notes",
                "score groups",
                "truth MIDI",
                "scenario family",
                "correctness label",
                "mutation category",
                "target note timestamp",
            ],
            "truthMidiAccessibleToAcousticExecutor": False,
            "predictionSealRequiredBeforeTruthScoring": True,
        },
        "stageB": {
            "name": "candidate-independent MIDI truth scoring",
            "truthSource": "synchronized same-performance MIDI",
            "primaryToleranceMs": 50,
            "sensitivityTolerancesMs": [25, 100],
            "matching": "pitch-aware one-to-one; maximize matched note-onset count then minimize absolute timing error",
        },
        "commonPreprocessing": {
            "canonicalInput": "16kHz mono PCM",
            "implementation": "deterministic_wav_pcm16_mono_linear_resample_16k_v1",
            "basicPitchAdditionalResampling": "frozen 16k-to-22050 deterministic adapter",
            "sameCanonicalSourceForAllCandidates": True,
        },
        "commonScoreableInterior": {
            "pastContextMs": 1000,
            "ownedRegionMs": 600,
            "futureContextMs": 220,
            "halfOpenOwnershipIntervals": True,
            "fakeZeroPaddingAllowed": False,
        },
        "metrics": [
            "note-onset precision",
            "note-onset recall",
            "note-onset F1",
            "false-positive onsets per minute",
            "missed-onset rate",
            "onset absolute timing median",
            "onset absolute timing P95",
            "duplicate/retrigger false detections",
            "chord-note completeness diagnostic where MIDI grouping supports it",
        ],
        "statistics": {
            "primaryUnit": "performance_take",
            "forbiddenUnit": "individual_note_event_as_independent_replicate",
            "pairedClusteredBootstrapDraws": 5000,
            "seed": 13371,
            "pairwiseComparisons": [
                "robust-browser-v1 vs online-amt-k8-browser-v1",
                "robust-browser-v1 vs basic-pitch-browser-v1",
                "online-amt-k8-browser-v1 vs basic-pitch-browser-v1",
            ],
        },
        "frontRunnerPolicy": {
            "label": "SCIENTIFIC_ACOUSTIC_FRONT_RUNNER",
            "requirements": [
                "runtime eligible",
                "complete SMD coverage",
                "50ms note-onset F1 statistically superior to both alternatives under paired policy",
                "no statistically significant regression versus either alternative in false-positive onsets/minute",
                "no statistically significant regression versus either alternative in missed-onset rate",
            ],
            "fallback": "NO_CLEAR_SCIENTIFIC_ACOUSTIC_WINNER",
            "notProductionWinner": True,
        },
        "runtimeDiagnostics": {
            "robustAndBasicPitch600msHeadroomMs": 480,
            "onlineAmtK8HeadroomMs": 204.8,
            "diagnosticOnlyNotAbsoluteUxSlo": True,
        },
        "candidateInferenceStarted": False,
    }
    report["protocolSha256"] = canonical_sha256(report)
    return report


def freeze_receipt(starting_head: str, reports: dict[str, dict[str, Any]]) -> dict[str, Any]:
    implementation_head = current_git_head()
    frozen = {
        "candidateIdentityFreeze": reports["candidateIdentityFreeze"]["candidateIdentityFreezeSha256"],
        "trainingOverlapAudit": reports["trainingOverlapAudit"]["trainingOverlapAuditSha256"],
        "smdDatasetPrerequisite": reports["smdDatasetPrerequisite"]["smdDatasetPrerequisiteSha256"],
        "publicScientificLaneAProtocol": reports["publicScientificLaneAProtocol"]["protocolSha256"],
    }
    receipt = {
        "phase": "PHASE_9G_XC1_FRESH_EXTERNAL_THREE_CANDIDATE_SCIENTIFIC_BAKEOFF",
        "artifact": "prospectiveFreezeReceipt",
        "date": "2026-10-14",
        "startingRemoteHead": starting_head,
        "implementationGitHead": implementation_head,
        "frozenHashes": frozen,
        "candidateInferenceStarted": False,
        "smdTruthLoadedByAcousticExecutor": False,
        "commercialQualificationStatus": "NOT_PERFORMED",
        "productionWinnerSelected": False,
        "scopeProtections": {
            "phase9gBOutcome": "STATISTICAL_TIE",
            "phase9gBWinner": None,
            "p15p22InferenceIncrease": 0,
            "productionMicrophoneEnabled": False,
            "practiceWebSocketRestored": False,
            "backendPracticeInferenceRestored": False,
            "d4QualificationPerformed": False,
        },
        "nextAllowedStep": "Acquire/freeze complete SMD take manifest from this prospective freeze before first candidate inference.",
    }
    receipt["freezeReceiptSha256"] = canonical_sha256(receipt)
    return receipt


def write_report(name: str, payload: dict[str, Any]) -> None:
    REPORTS.mkdir(parents=True, exist_ok=True)
    (REPORTS / name).write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--starting-head", required=True)
    args = parser.parse_args()

    identity = candidate_identity_freeze(args.starting_head)
    overlap = training_overlap_audit(args.starting_head)
    smd = smd_manifest_freeze(args.starting_head)
    protocol = qualification_protocol(
        args.starting_head,
        identity["candidateIdentityFreezeSha256"],
        overlap["trainingOverlapAuditSha256"],
        smd["smdDatasetPrerequisiteSha256"],
    )
    reports = {
        "candidateIdentityFreeze": identity,
        "trainingOverlapAudit": overlap,
        "smdDatasetPrerequisite": smd,
        "publicScientificLaneAProtocol": protocol,
    }
    receipt = freeze_receipt(args.starting_head, reports)

    write_report("phase9g_xc1_candidate_identity_freeze_2026-10-14.json", identity)
    write_report("phase9g_xc1_training_overlap_audit_2026-10-14.json", overlap)
    write_report("phase9g_xc1_smd_dataset_prerequisite_2026-10-14.json", smd)
    write_report("phase9g_xc1_public_scientific_lane_a_protocol_2026-10-14.json", protocol)
    write_report("phase9g_xc1_prospective_freeze_receipt_2026-10-14.json", receipt)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
