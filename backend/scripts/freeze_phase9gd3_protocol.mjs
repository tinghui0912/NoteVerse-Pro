#!/usr/bin/env node
// Phase 9G-D.3 protocol freeze artifact generator.
//
// This script writes compact policy/receipt JSON only. It does not run model
// inference, download datasets, or touch production Practice.

import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

const repoRoot = path.resolve('.');
const reportsDir = path.join(repoRoot, 'backend/research/reports');
const date = '2026-10-13';
const require = createRequire(import.meta.url);

function sha256Text(text) {
  return createHash('sha256').update(text).digest('hex');
}

async function fileSha256(relPath) {
  const body = await readFile(path.join(repoRoot, relPath));
  return createHash('sha256').update(body).digest('hex');
}

function canonical(value) {
  return JSON.stringify(sortDeep(value));
}

function canonicalSha256(value) {
  return sha256Text(canonical(value));
}

function sortDeep(value) {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, item]) => [key, sortDeep(item)]));
  }
  return value;
}

async function readJson(relPath) {
  return JSON.parse(await readFile(path.join(repoRoot, relPath), 'utf8'));
}

async function optionalJson(relPath) {
  const full = path.join(repoRoot, relPath);
  return existsSync(full) ? readJson(relPath) : null;
}

function summarize(values) {
  if (!values.length) return { count: 0, meanAbsDelta: null, p95AbsDelta: null, maxAbsDelta: null };
  const sorted = [...values].sort((a, b) => a - b);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  return {
    count: values.length,
    meanAbsDelta: mean,
    p95AbsDelta: percentile(sorted, 0.95),
    maxAbsDelta: sorted.at(-1),
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  if (sorted.length === 1) return sorted[0];
  const index = (sorted.length - 1) * p;
  const low = Math.floor(index);
  const high = Math.ceil(index);
  if (low === high) return sorted[low];
  return sorted[low] + (sorted[high] - sorted[low]) * (index - low);
}

function semanticObservation(observation) {
  return {
    observationId: observation.observationId,
    pitch: observation.pitch,
    performanceTimeMs: observation.performanceTimeMs,
  };
}

function semanticPublication(publication) {
  return {
    publicationId: publication.publicationId,
    analyzedThroughPerformanceMs: publication.analyzedThroughPerformanceMs,
    observations: (publication.observations ?? []).map(semanticObservation),
  };
}

function collectConfidenceDeltas(pythonPublications, browserPublications) {
  const browserById = new Map();
  for (const publication of browserPublications) {
    for (const observation of publication.observations ?? []) {
      browserById.set(observation.observationId, observation);
    }
  }
  const deltas = [];
  for (const publication of pythonPublications) {
    for (const observation of publication.observations ?? []) {
      const match = browserById.get(observation.observationId);
      if (!match) continue;
      deltas.push(Math.abs(Number(observation.confidence) - Number(match.confidence)));
    }
  }
  return summarize(deltas);
}

function extractPublicationsFromBridgeSample(label, bridgeReceipt) {
  const entry = bridgeReceipt?.receipt?.[label];
  if (!entry?.publicationsSample) return null;
  return entry.publicationsSample;
}

function d2r1Scenario() {
  return {
    scenarioId: 'phase9gd2r1-online-amt-p07-runtime-fixture',
    performerId: 'p07',
    fixedBpm: 120,
    audio: {
      sourceAudioPath: 'backend/data/work/public_proxy/vienna-4x22/audio-extracted/audio/Chopin_Ballade/Chopin_op38_p07.wav',
      sourceAudioSha256: 'nonblind-p07-runtime-fixture',
      nativeSampleRateHz: 44100,
      clipStartMs: 0,
      clipEndMs: 10240,
      performanceOriginSourceMs: 0,
    },
    completion: { performanceTimeMs: 10240 },
  };
}

async function runD2r1BridgeArtifact(label, artifactPath) {
  const { createJiti } = require(path.join(repoRoot, 'apps/customer-web/node_modules/jiti'));
  const jiti = createJiti(import.meta.url);
  const mod = jiti(path.join(repoRoot, 'apps/customer-web/src/lib/practice/research/online-amt-stateful-streaming.ts'));
  const artifact = await readJson(artifactPath);
  const run = mod.runOnlineAmtStreamingCandidateFromHopArtifact({
    scenario: d2r1Scenario(),
    artifact,
    candidateId: 'online-amt-browser-v1',
    command: `phase9g-d3 ${label} semantic publication bridge`,
    runtime: 'typescript-authoritative-online-amt-bridge',
    timingCorrectionMs: -162.93750000004252,
  });
  return run.publications;
}

async function d2r1FullBridgePublications() {
  const pythonArtifactPath = 'backend/data/work/phase9gd2r1_online_amt_browser/fixtures/python_hop_artifact.json';
  const browserArtifactPath = 'backend/data/work/phase9gd2r1_online_amt_browser/fixtures/browser_hop_artifact.json';
  if (!existsSync(path.join(repoRoot, pythonArtifactPath)) || !existsSync(path.join(repoRoot, browserArtifactPath))) {
    return null;
  }
  return {
    source: 'RECOMPUTED_FROM_EXISTING_D2R1_HOP_ARTIFACTS_NO_MODEL_INFERENCE',
    python: await runD2r1BridgeArtifact('python', pythonArtifactPath),
    browser: await runD2r1BridgeArtifact('browser', browserArtifactPath),
  };
}

function d2r1SemanticLayer(bridgeReport, fullBridgePublications = null) {
  const receipt = bridgeReport.typescriptBridge?.receipt;
  const parity = receipt?.parity ?? null;
  const pythonPublications = fullBridgePublications?.python ?? extractPublicationsFromBridgeSample('python', bridgeReport.typescriptBridge);
  const browserPublications = fullBridgePublications?.browser ?? extractPublicationsFromBridgeSample('browser', bridgeReport.typescriptBridge);
  const bridgeSource = fullBridgePublications?.source ?? 'COMMITTED_D2R1_BRIDGE_PUBLICATION_SAMPLE';
  let eventSemanticDigestEqual = null;
  let confidenceDelta = { status: 'NOT_COMPUTED_RAW_ARTIFACTS_UNAVAILABLE' };
  if (pythonPublications && browserPublications) {
    eventSemanticDigestEqual = canonicalSha256(pythonPublications.map(semanticPublication)) === canonicalSha256(browserPublications.map(semanticPublication));
    confidenceDelta = {
      status: fullBridgePublications
        ? 'COMPUTED_FROM_EXISTING_FULL_D2R1_HOP_ARTIFACTS_NO_MODEL_INFERENCE'
        : 'COMPUTED_FROM_BRIDGE_PUBLICATION_SAMPLE',
      ...collectConfidenceDeltas(pythonPublications, browserPublications),
    };
  }
  return {
    existingStrictDigestEqual: parity?.canonicalPublicationDigestEqual ?? false,
    eventSemanticParityIgnoringConfidence: {
      status: parity?.publicationCountEqual && parity?.observationCountEqual && parity?.finalAnalyzedThroughEqual && eventSemanticDigestEqual !== false
        ? 'PASS_EVENT_SEMANTIC_DIGEST_IGNORING_CONFIDENCE'
        : 'NOT_ESTABLISHED',
      bridgeSource,
      eventSemanticDigestEqual,
      digestFields: ['publicationId', 'observationId', 'pitch', 'performanceTimeMs', 'analyzedThroughPerformanceMs'],
      excludedFields: ['confidence', 'availabilityTimeMs', 'runtime diagnostics'],
    },
    confidenceParity: confidenceDelta,
    runtimeTimingParity: {
      status: 'NOT_REQUIRED_FOR_SEMANTIC_PARITY',
      reason: 'Python and browser artifacts intentionally carry different measured service latencies and availability diagnostics.',
    },
  };
}

async function main() {
  const d2r1RuntimePath = 'backend/research/reports/phase9g_d2r1_online_amt_worker_runtime_2026-10-13.json';
  const d2r1BridgePath = 'backend/research/reports/phase9g_d2r1_online_amt_publication_bridge_parity_2026-10-13.json';
  const d2r1GatePath = 'backend/research/reports/phase9g_d2r1_online_amt_real_native_gate_parity_2026-10-13.json';
  const d2r1FeasPath = 'backend/research/reports/phase9g_d2r1_online_amt_final_feasibility_2026-10-13.json';
  const d1rIdentityPath = 'backend/research/reports/phase9g_d1r_robust_browser_candidate_identity_export_2026-10-12.json';
  const d1rSemanticPath = 'backend/research/reports/phase9g_d1r_robust_canonical_semantic_parity_2026-10-12.json';
  const d1rPreprocessPath = 'backend/research/reports/phase9g_d1r_robust_frozen_preprocessing_receipt_2026-10-12.json';
  const publicRegistryPath = 'backend/research/policies/public_piano_dataset_registry_2026-10-08.json';

  const d2r1Runtime = await readJson(d2r1RuntimePath);
  const d2r1Bridge = await readJson(d2r1BridgePath);
  const d2r1Gate = await readJson(d2r1GatePath);
  const d2r1Feas = await readJson(d2r1FeasPath);
  const d1rIdentity = await readJson(d1rIdentityPath);
  const d1rSemantic = await readJson(d1rSemanticPath);
  const d1rPreprocess = await readJson(d1rPreprocessPath);
  const fullD2r1BridgePublications = await d2r1FullBridgePublications();

  const d2r1EvidenceHygiene = {
    schemaVersion: 1,
    artifact: 'phase9g_d3_d2r1_evidence_hygiene_receipt',
    phase: '9G-D.3',
    date,
    supersedesOnlyInterpretationOf: [
      d2r1RuntimePath,
      d2r1BridgePath,
      d2r1GatePath,
    ],
    d2r1ConclusionPreserved: 'ONLINE_AMT_BROWSER_REALTIME_BACKLOG_UNSTABLE',
    onlineAmtBrowserProductionEligibilityPreserved: 'NOT_ELIGIBLE_FOR_CURRENT_OFFLINE_FIRST_PRODUCTION_FINAL',
    queueEvidenceCorrection: {
      previousRisk: 'Worker report field names could be misread as a real wall-clock 32 ms feeder.',
      correctedLabel: 'MEASURED_WORKER_SERVICE_TIMES_PLUS_DETERMINISTIC_32MS_CAUSAL_QUEUE_SIMULATION',
      arrivalIntervalMs: 32,
      realTimerDrivenFeederExecuted: false,
      chromeMedianServiceMs: d2r1Runtime.chromeHeadedDefaultWebGpu.completeHopLatencyMs.p50,
      edgeMedianServiceMs: d2r1Runtime.edgeHeadedDefaultWebGpu.completeHopLatencyMs.p50,
      chromeQueueConclusion: d2r1Runtime.chromeHeadedDefaultWebGpu.backlogClassification,
      edgeQueueConclusion: d2r1Runtime.edgeHeadedDefaultWebGpu.backlogClassification,
    },
    misleadingFeederFieldsDisposition: {
      fields: ['scheduledAtMs', 'postedAtMs', 'workerStartedAtMs', 'workerFinishedAtMs'],
      status: 'RELABELED_AS_SIMULATED_OR_MODEL_DERIVED_FOR_D3_AND_LATER',
      noOnlineAmtOptimizationRerun: true,
    },
    publicationSemanticComparisonLayer: d2r1SemanticLayer(d2r1Bridge, fullD2r1BridgePublications),
    nativeGateEvidenceTerminology: {
      label: 'BROWSER_NATIVE_GATE_BEHAVIORAL_CONTRACT_PASS',
      exactPythonBrowserStateDigestParityClaimed: false,
      basis: {
        report: d2r1GatePath,
        behavior: '99/100 execute neural state update; 101/102 short-circuit while freezing mel/cache/h/c/prev_output; recovery resumes normal neural progression.',
      },
    },
    p15p22InferenceIncrease: 0,
  };

  const robustBrowserIdentityPayload = {
    deploymentId: 'robust-browser-v1',
    sourceCandidateId: 'bytedance-robust-augmented-calibrated-v1',
    sourceProfileId: 'CALIBRATED_CONTEXT_1820-onset-0.30-frame-0.05',
    sourceConfigurationSha256: '10ca01435f68b0672d01e2328762ea0773efb15b318dcd1c21105e05f9ee51ce',
    checkpointSha256: 'b20f72053abc15b78f689b2a8b04c0a06529c8466e898b915803a1daa2011b9e',
    checkpointBytes: 103815845,
    onnxSha256: '4242faf321f276404985e5d00a9ab41dc6bc7063df2b635c6bbc4dede50715d3',
    onnxBytes: 98689283,
    opset: 18,
    input: { dtype: 'float32', shape: [1, 29120] },
    observedOutput: { shape: [1, 183, 88], tensors: ['reg_onset_output', 'frame_output'] },
    sampleRateHz: 16000,
    modelInputMs: 1820,
    ownedRegionMs: 600,
    futureContextMs: 220,
    onsetThreshold: 0.3,
    frameThreshold: 0.05,
    ortWebVersion: '1.20.1',
    primaryProvider: 'webgpu',
    automaticWasmFallback: false,
    preprocessingIdentity: {
      name: 'deterministic_wav_pcm16_mono_linear_resample_16k_v1',
      receipt: d1rPreprocessPath,
      receiptSha256: await fileSha256(d1rPreprocessPath),
    },
    canonicalDecoderIdentity: {
      path: 'apps/customer-web/src/lib/practice/research/bytedance-score-aware-chunked.ts::decodeByteDanceChunkRawOutputs',
      receipt: d1rSemanticPath,
      receiptSha256: await fileSha256(d1rSemanticPath),
    },
    ownershipFilteringIdentity: {
      path: 'apps/customer-web/src/lib/practice/research/bytedance-score-aware-chunked.ts::observationsForByteDanceChunk',
      receipt: d1rSemanticPath,
      receiptSha256: await fileSha256(d1rSemanticPath),
    },
    browserRuntimeEvidence: {
      candidateIdentityReceipt: d1rIdentityPath,
      candidateIdentityReceiptSha256: await fileSha256(d1rIdentityPath),
      browserRuntimeReceipt: 'backend/research/reports/phase9g_d1r_robust_default_browser_runtime_2026-10-12.json',
    },
    historicalCudaDeploymentEquivalent: false,
    cudaRelationship: {
      cpuPythonOrtBrowserCanonicalSemantics: 'PASS_ON_D1R_FIXTURES',
      historicalCudaToCpuBrowser: 'NOT_STRICTLY_EQUIVALENT',
      note: 'Phase 9G-B CUDA/PyTorch scores must not be transferred as browser deployment scores.',
    },
  };
  const robustBrowserIdentity = {
    schemaVersion: 1,
    artifact: 'phase9g_d3_robust_browser_v1_identity',
    phase: '9G-D.3',
    date,
    identity: robustBrowserIdentityPayload,
    deploymentIdentitySha256: canonicalSha256(robustBrowserIdentityPayload),
  };

  const roleRegistry = {
    schemaVersion: 1,
    artifact: 'phase9g_d3_browser_candidate_role_registry',
    phase: '9G-D.3',
    date,
    candidates: [
      {
        candidateId: 'robust-browser-v1',
        sourceCandidateId: 'bytedance-robust-augmented-calibrated-v1',
        role: 'CURRENT_OFFLINE_FIRST_PRODUCTION_FINALIST',
        status: 'ELIGIBLE_FOR_NEW_EXTERNAL_QUALIFICATION',
        productionWinner: 'NOT_YET_SELECTED',
        deploymentIdentitySha256: robustBrowserIdentity.deploymentIdentitySha256,
      },
      {
        candidateId: 'online-amt-browser-v1',
        sourceCandidateId: 'online-amt-calibrated-v1',
        role: 'SCIENTIFIC_REFERENCE',
        status: 'NOT_ELIGIBLE_FOR_CURRENT_OFFLINE_FIRST_PRODUCTION_FINAL',
        reason: '32 ms causal recurrence cannot be serviced sustainably by the final bounded ORT Web/WebGPU combined-worker implementation on the measured environment.',
        d2r1Outcome: d2r1Feas.outcome,
      },
      {
        candidateId: 'transkun-v2-aug',
        role: 'RESEARCH_REFERENCE_ONLY',
        status: 'INELIGIBLE_DUE_TO_WHOLE_RECORDING_OFFLINE_LATENCY',
      },
      {
        candidateId: 'aria-amt',
        role: 'RESEARCH_REFERENCE_ONLY',
        status: 'INELIGIBLE_DUE_TO_LICENSE_AND_OFFLINE_LATENCY',
      },
      {
        candidateId: 'rtt',
        role: 'RESEARCH_REFERENCE_ONLY',
        status: 'NOT_REOPENED_IN_D3',
        evidence: [
          'strict causal streaming execution not established',
          'deterministic product acoustic threshold gate failed',
          'RTT to ByteDance candidate handoff failed sequential safety',
          'current production licensing blocked/unresolved',
        ],
      },
      {
        candidateId: 'd3rm',
        role: 'RESEARCH_REFERENCE_ONLY',
        status: 'EXECUTION_BLOCKED_NOT_ELIGIBLE',
      },
    ],
    productionMicrophoneEnabled: false,
    productionWinnerSelected: false,
    p15p22InferenceIncrease: 0,
  };

  const historicalExposure = {
    schemaVersion: 1,
    artifact: 'phase9g_d3_historical_dataset_exposure_registry',
    phase: '9G-D.3',
    date,
    datasets: [
      {
        datasetId: 'vienna-4x22',
        role: 'DEVELOPMENT_CALIBRATION_REGRESSION_PUBLIC_PROXY_ONLY',
        eligibleAsNewFinalExternalCorpus: false,
        performerExposure: [
          {
            performers: 'p01-p14',
            roles: ['DEVELOPMENT', 'CALIBRATION'],
            evidence: [
              { path: 'backend/research/reports/phase9g_a_vienna_calibration_scenarios_2026-10-09.json', sha256: await fileSha256('backend/research/reports/phase9g_a_vienna_calibration_scenarios_2026-10-09.json') },
              { path: 'backend/research/reports/phase9g_a1_vienna_calibration_scenarios_2026-10-09.json', sha256: await fileSha256('backend/research/reports/phase9g_a1_vienna_calibration_scenarios_2026-10-09.json') },
            ],
          },
          {
            performers: 'p07-p14',
            roles: ['PHASE_9G_CALIBRATION'],
            evidence: [
              { path: 'backend/research/reports/phase9g_a_vienna_calibration_current_baselines_2026-10-09.json', sha256: await fileSha256('backend/research/reports/phase9g_a_vienna_calibration_current_baselines_2026-10-09.json') },
            ],
          },
          {
            performers: 'p15-p22',
            roles: ['BLIND_HISTORICAL'],
            evidence: [
              { path: 'backend/research/reports/phase9g_b_blind_truth_only_scenarios_2026-10-09.json', sha256: await fileSha256('backend/research/reports/phase9g_b_blind_truth_only_scenarios_2026-10-09.json') },
              { path: 'backend/research/reports/phase9g_b3_official_product_blind_replacement_result_2026-10-11.json', sha256: await fileSha256('backend/research/reports/phase9g_b3_official_product_blind_replacement_result_2026-10-11.json') },
            ],
          },
        ],
      },
      {
        datasetId: 'maestro',
        role: 'DEVELOPMENT_PARITY_DEBUG_REGRESSION_ONLY',
        eligibleAsNewFinalExternalCorpus: false,
        reason: 'KNOWN_TRAINING_DOMAIN_OVERLAP',
      },
    ],
    p15p22InferenceIncrease: 0,
  };

  const corpusAudit = {
    schemaVersion: 1,
    artifact: 'phase9g_d3_external_corpus_eligibility_audit',
    phase: '9G-D.3',
    date,
    noLargeCorpusDownloaded: true,
    corpora: [
      {
        datasetId: 'vienna-4x22',
        eligibility: 'BARRED_FROM_NEW_EXTERNAL_FINAL',
        reason: 'All performer IDs p01-p22 have participated in development/calibration/blind research lifecycle.',
        trainingOverlapStatus: 'NO_DOCUMENTED_OVERLAP_IN_PUBLISHED_TRAINING_DECLARATIONS',
      },
      {
        datasetId: 'maestro',
        eligibility: 'BARRED_FROM_NEW_EXTERNAL_FINAL',
        reason: 'KNOWN_TRAINING_DOMAIN_OVERLAP',
        allowedRoles: ['DEVELOPMENT', 'PARITY', 'DEBUGGING', 'REGRESSION'],
      },
      {
        datasetId: 'smd',
        canonicalName: 'Saarland Music Data MIDI-Audio Piano Music',
        authoritativeSourceUrl: 'https://audiolabs-erlangen.com/resources/MIR/SMD/midi',
        license: 'CC BY-NC-SA 3.0 Unported',
        licenseEvidence: 'AudioLabs SMD page states the MIDI-Audio pairs are licensed under Creative Commons Attribution-NonCommercial-ShareAlike 3.0 Unported.',
        synchronizationClaim: 'Audio recordings along with perfectly synchronized MIDI files for piano pieces.',
        performerInstrumentSource: 'Saarland Music Data piano collection; public page does not by itself establish commercial product rights.',
        scoreOrAlignment: 'MIDI-audio synchronization; score files/alignment for fixed-BPM Practice proxy not established in D.3.',
        trainingOverlapStatus: 'NO_DOCUMENTED_OVERLAP_IN_PUBLISHED_TRAINING_DECLARATIONS',
        scientificExternalValidationRole: 'POTENTIAL_PRIMARY_LANE_A_AFTER_LOCAL_ACQUISITION_AND_SPLIT_FREEZE',
        decisionCriticalCommercialProductQualification: 'LICENSE_DECISION_REQUIRED',
        eligibility: 'PUBLIC_EXTERNAL_PRIMARY_CORPUS_NOT_YET_ELIGIBLE_FOR_DECISION_CRITICAL_PRODUCT_QUALIFICATION',
      },
      {
        datasetId: 'maps',
        canonicalName: 'MAPS Database / MIDI Aligned Piano Sounds',
        authoritativeSourceUrl: 'https://adasp.telecom-paris.fr/resources/2010-07-08-maps-database/',
        license: 'Creative Commons license; exact commercial decision unresolved in D.3',
        provenance: 'Includes high-quality audio from virtual piano software and Yamaha Disklavier with aligned MIDI.',
        subsetRoles: ['synthesized/generated', 'Disklavier/acoustic'],
        humanPerformanceStatus: 'MIXED_OR_NOT_PRIMARY_HUMAN_FIXED_BPM_PRACTICE_EVIDENCE',
        synchronizedMidiAudio: true,
        suitableForOnsetTruth: 'YES_FOR_SECONDARY_ACOUSTIC_STRESS_WHERE_SUBSET_METADATA_SUPPORTS_IT',
        trainingOverlapStatus: 'NO_DOCUMENTED_OVERLAP_IN_PUBLISHED_TRAINING_DECLARATIONS',
        eligibility: 'SECONDARY_ACOUSTIC_STRESS_GENERALIZATION_REFERENCE',
      },
      {
        datasetId: 'giantmidi-piano',
        eligibility: 'NOT_PRIMARY_PAIRED_TRUTH',
        reason: 'MIDI is produced by automatic transcription of internet audio, not physical same-performance MIDI truth.',
      },
    ],
    primaryExternalCorpusDecision: 'PUBLIC_EXTERNAL_PRIMARY_CORPUS_NOT_YET_ELIGIBLE',
    atLeastOneDecisionCriticalEligibleCorpus: false,
  };

  const protocolPolicy = {
    protocolId: 'robust-browser-v1-public-external-production-qualification-v1',
    title: 'Robust-Browser-v1 Public-External Production Qualification',
    candidate: {
      deploymentId: 'robust-browser-v1',
      identitySha256: robustBrowserIdentity.deploymentIdentitySha256,
    },
    laneA: {
      status: 'PRIMARY_WHEN_ELIGIBLE_CORPUS_IS_FROZEN',
      modelInputsAllowed: ['real acoustic piano audio'],
      modelInputsForbidden: ['truth MIDI', 'score', 'expected pitch', 'target timestamp', 'alignment', 'case label'],
      sequence: [
        'Run Robust-Browser-v1 on audio only.',
        'Seal and hash predictions.',
        'Reveal synchronized same-performance MIDI truth.',
        'Score with candidate-independent matching policy.',
      ],
    },
    laneB: {
      status: 'NOT_AVAILABLE_UNTIL_NEW_CORPUS_HAS_TRUSTWORTHY_SCORE_PERFORMANCE_ALIGNMENT',
      requirement: 'score + performance alignment + audio + same-performance MIDI',
      transformationPolicy: 'candidate-independent only',
    },
    statisticalPolicy: {
      primaryUnit: 'performance_take',
      forbiddenUnit: 'individual_note_strike_as_independent_replicate',
      clustering: ['piece', 'performer', 'instrument_or_recording_source where metadata supports it'],
      bootstrap: {
        method: 'clustered_resampling_over_performance_take_units',
        confidenceInterval: '95%',
        draws: 5000,
        seed: 13371,
      },
    },
    matchingPolicy: {
      primaryToleranceMs: 50,
      rationale: 'Standard AMT note-onset matching tolerance frozen prospectively for D.4; no tolerance sweep may choose the headline result.',
      sensitivityDiagnosticsMs: [25, 100],
      sensitivityMayChangeHeadline: false,
    },
    metrics: {
      primary: ['noteOnsetPrecision', 'noteOnsetRecall', 'noteOnsetF1', 'falsePositiveOnsetsPerMinute', 'onsetTimingAbsoluteMedianMs', 'onsetTimingAbsoluteP95Ms'],
      safety: ['spuriousOnsetDensity', 'missedOnsetRate', 'pitchSubstitutionWrongSemitoneConfusionWhereDerivable', 'duplicateRetriggerFalseDetections', 'chordNoteCompletenessDiagnosticsWhereTruthSupportsIt'],
      secondary: ['noteWithOffsetMetricDiagnosticWhereGroundTruthSupportsIt'],
      forbidden: ['fabricated STEP verdicts from audio+MIDI-only corpus'],
    },
    runtimePolicy: {
      record: ['modelLoadLatency', 'firstInferenceLatency', 'steadyInferenceP50P95', 'queueDelayP50P95Max', 'publicationDelayAfterCommitEnd', 'backlogBehavior'],
      structuralRequirement: '600 ms arrival cadence must not produce sustained unbounded backlog',
      absoluteProductLatencyGate: 'ABSOLUTE_PRODUCT_LATENCY_GATE_NOT_YET_DEFINED',
    },
    absoluteProductAccuracyGate: 'ABSOLUTE_PRODUCT_ACCURACY_GATE_NOT_YET_DEFINED',
    failurePolicy: {
      noEligibleCorpus: 'STOP_BEFORE_INFERENCE',
      componentIdentityDrift: 'CANDIDATE_IDENTITY_CHANGED_PROTOCOL_INVALID_FOR_OLD_IDENTITY',
      predictionNotSealedBeforeTruth: 'INVALID_EVALUATION_NO_PRODUCT_DECISION',
    },
    p15p22InferenceIncrease: 0,
  };

  const protocol = {
    schemaVersion: 1,
    artifact: 'phase9g_d3_public_external_qualification_protocol',
    phase: '9G-D.3',
    date,
    policy: protocolPolicy,
    protocolSha256: canonicalSha256(protocolPolicy),
  };

  const freezePayload = {
    robustBrowserIdentitySha256: robustBrowserIdentity.deploymentIdentitySha256,
    datasetEligibilityDecisionSha256: canonicalSha256(corpusAudit),
    historicalExposureRegistrySha256: canonicalSha256(historicalExposure),
    candidateRoleRegistrySha256: canonicalSha256(roleRegistry),
    scoringPolicySha256: canonicalSha256(protocolPolicy.matchingPolicy),
    statisticalPolicySha256: canonicalSha256(protocolPolicy.statisticalPolicy),
    metricDefinitionsSha256: canonicalSha256(protocolPolicy.metrics),
    runtimePolicySha256: canonicalSha256(protocolPolicy.runtimePolicy),
    absoluteGateStatus: {
      accuracy: protocolPolicy.absoluteProductAccuracyGate,
      latency: protocolPolicy.runtimePolicy.absoluteProductLatencyGate,
    },
    tieFailurePolicySha256: canonicalSha256(protocolPolicy.failurePolicy),
    protocolSha256: protocol.protocolSha256,
  };
  const freezeReceipt = {
    schemaVersion: 1,
    artifact: 'phase9g_d3_protocol_freeze_receipt',
    phase: '9G-D.3',
    date,
    noFinalExternalInferenceOccurred: true,
    protocolMayRunOnlyAfterThisReceiptIsCommitted: true,
    frozenHashes: freezePayload,
    freezeReceiptSha256: canonicalSha256(freezePayload),
    productionMicrophoneEnabled: false,
    productionWinnerSelected: false,
    phase9gBHistoricalConclusion: { outcome: 'STATISTICAL_TIE', winner: null },
    p15p22InferenceIncrease: 0,
  };

  const artifacts = [
    ['phase9g_d3_d2r1_evidence_hygiene_receipt', d2r1EvidenceHygiene],
    ['phase9g_d3_browser_candidate_role_registry', roleRegistry],
    ['phase9g_d3_robust_browser_v1_identity', robustBrowserIdentity],
    ['phase9g_d3_historical_dataset_exposure_registry', historicalExposure],
    ['phase9g_d3_external_corpus_eligibility_audit', corpusAudit],
    ['phase9g_d3_public_external_qualification_protocol', protocol],
    ['phase9g_d3_protocol_freeze_receipt', freezeReceipt],
  ];
  for (const [name, artifact] of artifacts) {
    await writeFile(path.join(reportsDir, `${name}_${date}.json`), JSON.stringify(artifact, null, 2) + '\n', 'utf8');
  }
  console.log(JSON.stringify({ protocolSha256: protocol.protocolSha256, robustBrowserIdentitySha256: robustBrowserIdentity.deploymentIdentitySha256 }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
