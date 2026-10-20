from __future__ import annotations

import json
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
REPORTS = REPO_ROOT / "backend" / "research" / "reports"


def read_report(name: str) -> dict:
    path = REPORTS / f"{name}_2026-10-13.json"
    assert path.exists(), f"missing Phase 9G-D.3 report: {path}"
    return json.loads(path.read_text(encoding="utf-8"))


def test_d2r1_queue_evidence_is_not_labeled_as_real_timer_feeder() -> None:
    report = read_report("phase9g_d3_d2r1_evidence_hygiene_receipt")
    correction = report["queueEvidenceCorrection"]

    assert correction["correctedLabel"] == "MEASURED_WORKER_SERVICE_TIMES_PLUS_DETERMINISTIC_32MS_CAUSAL_QUEUE_SIMULATION"
    assert correction["realTimerDrivenFeederExecuted"] is False
    assert "REAL_32MS_FEEDER" not in json.dumps(report)
    assert report["d2r1ConclusionPreserved"] == "ONLINE_AMT_BROWSER_REALTIME_BACKLOG_UNSTABLE"
    assert report["onlineAmtBrowserProductionEligibilityPreserved"] == "NOT_ELIGIBLE_FOR_CURRENT_OFFLINE_FIRST_PRODUCTION_FINAL"
    assert report["p15p22InferenceIncrease"] == 0


def test_d2r1_publication_semantics_are_separated_from_confidence_and_runtime() -> None:
    report = read_report("phase9g_d3_d2r1_evidence_hygiene_receipt")
    layer = report["publicationSemanticComparisonLayer"]

    assert layer["existingStrictDigestEqual"] is False
    assert layer["eventSemanticParityIgnoringConfidence"]["status"] == "PASS_EVENT_SEMANTIC_DIGEST_IGNORING_CONFIDENCE"
    assert layer["eventSemanticParityIgnoringConfidence"]["eventSemanticDigestEqual"] is True
    assert layer["eventSemanticParityIgnoringConfidence"]["bridgeSource"] == (
        "RECOMPUTED_FROM_EXISTING_D2R1_HOP_ARTIFACTS_NO_MODEL_INFERENCE"
    )
    assert "confidence" in layer["eventSemanticParityIgnoringConfidence"]["excludedFields"]
    assert layer["confidenceParity"]["count"] == 65
    assert layer["confidenceParity"]["maxAbsDelta"] < 0.00002
    assert layer["runtimeTimingParity"]["status"] == "NOT_REQUIRED_FOR_SEMANTIC_PARITY"


def test_native_gate_label_does_not_overclaim_python_browser_state_digest_parity() -> None:
    report = read_report("phase9g_d3_d2r1_evidence_hygiene_receipt")
    terminology = report["nativeGateEvidenceTerminology"]

    assert terminology["label"] == "BROWSER_NATIVE_GATE_BEHAVIORAL_CONTRACT_PASS"
    assert terminology["exactPythonBrowserStateDigestParityClaimed"] is False


def test_browser_candidate_roles_freeze_online_amt_as_reference_only() -> None:
    registry = read_report("phase9g_d3_browser_candidate_role_registry")
    candidates = {candidate["candidateId"]: candidate for candidate in registry["candidates"]}

    robust = candidates["robust-browser-v1"]
    online = candidates["online-amt-browser-v1"]

    assert robust["role"] == "CURRENT_OFFLINE_FIRST_PRODUCTION_FINALIST"
    assert robust["status"] == "ELIGIBLE_FOR_NEW_EXTERNAL_QUALIFICATION"
    assert robust["productionWinner"] == "NOT_YET_SELECTED"
    assert online["role"] == "SCIENTIFIC_REFERENCE"
    assert online["status"] == "NOT_ELIGIBLE_FOR_CURRENT_OFFLINE_FIRST_PRODUCTION_FINAL"
    assert "32 ms causal recurrence" in online["reason"]
    assert registry["productionWinnerSelected"] is False
    assert registry["p15p22InferenceIncrease"] == 0


def test_robust_browser_v1_is_distinct_from_historical_cuda_deployment() -> None:
    identity = read_report("phase9g_d3_robust_browser_v1_identity")

    robust = identity["identity"]
    assert robust["deploymentId"] == "robust-browser-v1"
    assert robust["sourceCandidateId"] == "bytedance-robust-augmented-calibrated-v1"
    assert robust["checkpointSha256"] == "b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e"
    assert robust["onnxSha256"] == "4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3"
    assert robust["primaryProvider"] == "webgpu"
    assert robust["automaticWasmFallback"] is False
    assert robust["historicalCudaDeploymentEquivalent"] is False
    assert identity["deploymentIdentitySha256"] == "196a9a2ceb03569f6e266c4f5973125bb8596146882079105ee94ef7e621deed"


def test_vienna_and_maestro_are_barred_from_new_external_final_role() -> None:
    exposure = read_report("phase9g_d3_historical_dataset_exposure_registry")
    audit = read_report("phase9g_d3_external_corpus_eligibility_audit")

    exposure_datasets = {dataset["datasetId"]: dataset for dataset in exposure["datasets"]}
    audit_corpora = {corpus["datasetId"]: corpus for corpus in audit["corpora"]}

    vienna = exposure_datasets["vienna-4x22"]
    assert vienna["eligibleAsNewFinalExternalCorpus"] is False
    exposures = {entry["performers"]: entry for entry in vienna["performerExposure"]}
    assert "DEVELOPMENT" in exposures["p01-p14"]["roles"]
    assert "PHASE_9G_CALIBRATION" in exposures["p07-p14"]["roles"]
    assert "BLIND_HISTORICAL" in exposures["p15-p22"]["roles"]
    assert all(evidence["sha256"] for entry in exposures.values() for evidence in entry["evidence"])

    assert audit_corpora["vienna-4x22"]["eligibility"] == "BARRED_FROM_NEW_EXTERNAL_FINAL"
    assert audit_corpora["maestro"]["eligibility"] == "BARRED_FROM_NEW_EXTERNAL_FINAL"
    assert audit_corpora["maestro"]["reason"] == "KNOWN_TRAINING_DOMAIN_OVERLAP"


def test_protocol_forbids_truth_inputs_and_note_level_bootstrap_before_inference() -> None:
    protocol = read_report("phase9g_d3_public_external_qualification_protocol")
    freeze = read_report("phase9g_d3_protocol_freeze_receipt")
    policy = protocol["policy"]

    assert "truth MIDI" in policy["laneA"]["modelInputsForbidden"]
    assert "score" in policy["laneA"]["modelInputsForbidden"]
    assert "Seal and hash predictions." in policy["laneA"]["sequence"]
    assert policy["statisticalPolicy"]["primaryUnit"] == "performance_take"
    assert policy["statisticalPolicy"]["forbiddenUnit"] == "individual_note_strike_as_independent_replicate"
    assert policy["runtimePolicy"]["absoluteProductLatencyGate"] == "ABSOLUTE_PRODUCT_LATENCY_GATE_NOT_YET_DEFINED"
    assert policy["absoluteProductAccuracyGate"] == "ABSOLUTE_PRODUCT_ACCURACY_GATE_NOT_YET_DEFINED"
    assert protocol["protocolSha256"] == freeze["frozenHashes"]["protocolSha256"]
    assert freeze["noFinalExternalInferenceOccurred"] is True
    assert freeze["p15p22InferenceIncrease"] == 0
