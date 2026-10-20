from __future__ import annotations

import json
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
REPORTS = REPO_ROOT / "backend" / "research" / "reports"
STARTING_HEAD = "a2842d41521e71d9add9437dd2d0d8dff2e596e5"


def generate_reports() -> None:
    subprocess.run(
        [
            "python",
            str(REPO_ROOT / "backend" / "research" / "tools" / "freeze_phase9g_xc1_protocol.py"),
            "--starting-head",
            STARTING_HEAD,
        ],
        cwd=REPO_ROOT,
        check=True,
    )


def read_report(name: str) -> dict:
    path = REPORTS / f"{name}_2026-10-14.json"
    assert path.exists(), f"missing XC1 report: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


def test_xc1_candidate_identity_freeze_binds_all_three_deployments() -> None:
    generate_reports()
    report = read_report("phase9g_xc1_candidate_identity_freeze")
    identities = report["identities"]

    assert report["startingRemoteHead"] == STARTING_HEAD
    assert report["candidateInferenceStarted"] is False
    assert identities["robust-browser-v1"]["deploymentIdentitySha256"] == (
        "196a9a2ceb03569f6e266c4f5973125bb8596146882079105ee94ef7e621deed"
    )
    assert identities["robust-browser-v1"]["historicalCudaMetricsTransferred"] is False
    assert identities["online-amt-k8-browser-v1"]["eligibilityDisposition"] == (
        "ONLINE_AMT_K8_ELIGIBLE_FOR_FRESH_CROSS_CANDIDATE_QUALIFICATION"
    )
    assert identities["online-amt-k8-browser-v1"]["k8OnnxSha256"] == (
        "818c095a3e96f507f45fe5f394169660cb3848fb7e496699a99c1957b51e9f18"
    )
    assert identities["basic-pitch-browser-v1"]["packageVersion"] == "1.0.1"
    assert identities["basic-pitch-browser-v1"]["decoder"]["scoreBlind"] is True
    assert identities["basic-pitch-browser-v1"]["decoder"]["emitsAllPianoPitches"] is True
    assert identities["basic-pitch-browser-v1"]["decoder"]["historicalFixedAnchorStepVerifierEvidenceTransferred"] is False


def test_xc1_training_overlap_audit_keeps_smd_scientific_only() -> None:
    generate_reports()
    audit = read_report("phase9g_xc1_training_overlap_audit")

    assert audit["primaryCorpus"] == "SMD MIDI-Audio Piano Music Version 2"
    assert audit["license"] == "CC BY-NC-SA 3.0"
    assert audit["commercialQualificationStatus"] == "NOT_PERFORMED"
    assert audit["scientificResearchOnly"] is True
    assert audit["knownOverlapDetected"] is False
    assert audit["unknownOverlapRemaining"] is False
    assert audit["candidateInferenceAllowedByOverlapAudit"] is True
    assert audit["candidateOverlapStatus"]["basic-pitch-browser-v1"]["smdOverlapStatus"] == "NO_DOCUMENTED_OVERLAP"
    assert "not a proof" in audit["caution"]


def test_xc1_protocol_seals_predictions_before_truth_and_forbids_score_inputs() -> None:
    generate_reports()
    protocol = read_report("phase9g_xc1_public_scientific_lane_a_protocol")

    assert protocol["notD4"] is True
    assert protocol["stageA"]["predictionSealRequiredBeforeTruthScoring"] is True
    assert protocol["stageA"]["truthMidiAccessibleToAcousticExecutor"] is False
    assert "truth MIDI" in protocol["stageA"]["modelInputsForbidden"]
    assert "expected pitch" in protocol["stageA"]["modelInputsForbidden"]
    assert protocol["stageB"]["primaryToleranceMs"] == 50
    assert protocol["stageB"]["sensitivityTolerancesMs"] == [25, 100]
    assert protocol["statistics"]["primaryUnit"] == "performance_take"
    assert protocol["statistics"]["forbiddenUnit"] == "individual_note_event_as_independent_replicate"
    assert protocol["statistics"]["pairedClusteredBootstrapDraws"] == 5000
    assert protocol["statistics"]["seed"] == 13371
    assert protocol["frontRunnerPolicy"]["notProductionWinner"] is True
    assert protocol["candidateInferenceStarted"] is False


def test_xc1_smd_manifest_must_freeze_before_inference() -> None:
    generate_reports()
    smd = read_report("phase9g_xc1_smd_dataset_prerequisite")

    assert smd["dataset"]["datasetId"] == "smd-midi-audio-piano-music-v2"
    assert smd["dataset"]["requiredAudioMaterial"] == "original WAV files from Zenodo, not MP3 previews"
    assert smd["takeManifestStatus"] == "NOT_ACQUIRED_YET"
    assert smd["takeManifestFreezeRequiredBeforeInference"] is True
    assert smd["candidateInferenceStarted"] is False
    assert smd["candidateIndependentInclusionPolicy"]["forbiddenExclusionBasis"] == (
        "candidate output or candidate-specific performance"
    )


def test_xc1_freeze_receipt_preserves_scope_protections() -> None:
    generate_reports()
    receipt = read_report("phase9g_xc1_prospective_freeze_receipt")

    assert receipt["candidateInferenceStarted"] is False
    assert receipt["smdTruthLoadedByAcousticExecutor"] is False
    assert receipt["commercialQualificationStatus"] == "NOT_PERFORMED"
    assert receipt["productionWinnerSelected"] is False
    protections = receipt["scopeProtections"]
    assert protections["phase9gBOutcome"] == "STATISTICAL_TIE"
    assert protections["phase9gBWinner"] is None
    assert protections["p15p22InferenceIncrease"] == 0
    assert protections["productionMicrophoneEnabled"] is False
    assert protections["practiceWebSocketRestored"] is False
    assert protections["backendPracticeInferenceRestored"] is False
    assert protections["d4QualificationPerformed"] is False
