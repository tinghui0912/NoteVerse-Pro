#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const repoRoot = process.cwd();
const reportDir = path.resolve(repoRoot, 'backend/research/reports');
mkdirSync(reportDir, { recursive: true });

const SEALED_PHASE_9GB = {
  replacementResult: {
    path: 'backend/research/reports/phase9g_b3_official_product_blind_replacement_result_2026-10-11.json',
    sha256: '8dba0ef149dcf6f5c995f8ab4e07df85a41b48b81bd2323d8dc39e1b67e8c706',
  },
  replacementReceipt: {
    path: 'backend/research/reports/phase9g_b3_official_product_blind_replacement_execution_receipt_2026-10-11.json',
    sha256: '42a92eab2dca96de328aefa786283c6dcae477ba155775b54caea4964e2ee0eb',
  },
  attempt1Result: {
    path: 'backend/research/reports/phase9g_b3_official_product_blind_result_2026-10-11.json',
    sha256: 'f94c133d496a6bdf89204d59bd9d7fb07ed1c800bebfb3ee195e2f939b059eb1',
  },
  attempt1Receipt: {
    path: 'backend/research/reports/phase9g_b3_official_product_blind_execution_receipt_2026-10-11.json',
    sha256: 'deac086db5654ae71deceae7c659a8307ff85e01f652a776144b757170f6dfca',
  },
  attempt1Invalidation: {
    path: 'backend/research/reports/phase9g_b3_official_blind_attempt1_invalidation_2026-10-11.json',
    sha256: '949bfdb930c07d5037b9ce9ec0e4c86685c3745f7d1c3f0458c817319ade25d8',
  },
};

const C1_ARTIFACT = {
  path: 'backend/research/reports/phase9g_c1_audit_history_and_runtime_boundary_2026-10-12.json',
  sha256: '7860d29f8f46272e08164f7fa4d68222006762283c5d034bd8f6fecefe0f1b4f',
};

const EMPTY_PAIRED_MANIFEST = 'backend/research/fixtures/continuous_paired_take_manifest_v2_empty_development_2026-10-08.json';

const sealed = verifySealedArtifacts();
const c1 = readAndVerifyJson(C1_ARTIFACT);
const pairedManifest = readJson(EMPTY_PAIRED_MANIFEST);
const productFiles = inspectProductRuntimeFoundation();
const blockerChecks = evaluatePreconditions({ c1, pairedManifest, productFiles });
const outcome = blockerChecks.every((check) => check.status === 'PASS')
  ? 'PHASE_9GC2_READY_FOR_PRODUCTION_MICROPHONE_EVALUATION'
  : 'PHASE_9GC2_BLOCKED_ON_RUNTIME_FOUNDATION';

const report = {
  schemaVersion: 1,
  artifact: 'phase9g_c2_production_microphone_precondition_gate',
  phase: '9G-C.2',
  gitHead: git('rev-parse', 'HEAD'),
  phase9gBClosure: {
    permanentlyClosed: true,
    scientificConclusion: 'STATISTICAL_TIE',
    winner: null,
    sealedArtifactsPreservedByteForByte: sealed,
    p15p22InferenceIncrease: 0,
    noAdditionalBlindInference: true,
    officialReplacementProtocolExceptionPreserved: true,
    strictOriginalOneShotNoRetryComplianceClaimed: false,
  },
  phase9gC1FoundationStatus: {
    sourceArtifact: C1_ARTIFACT,
    productPathOutcome: c1.runtimeValidationSource.productPathOutcome,
    actualRepositoryBoundaryFound: c1.productionShapedVerticalPath.actualRepositoryBoundaryFound,
    noNewAuthenticationSubsystemIntroduced: c1.productionShapedVerticalPath.existingBackendConvention.noNewAuthenticationSubsystemIntroduced,
    noNewInfrastructureSubsystemIntroduced: c1.productionShapedVerticalPath.existingBackendConvention.noNewInfrastructureSubsystemIntroduced,
    runtimeStateOwnershipRecorded: c1.persistentRuntimeStateOwnership,
  },
  preconditionChecks: blockerChecks,
  blockers: blockerChecks.filter((check) => check.status !== 'PASS'),
  preservedFinalists: {
    robust: {
      candidateId: 'bytedance-robust-augmented-calibrated-v1',
      frozenRepresentativeProfile: 'CALIBRATED_CONTEXT_1820-onset-0.30-frame-0.05',
      geometry: { modelInputMs: 1820, futureContextMs: 220, commitWidthMs: 600 },
      note: 'Frozen selected representative profile; not described as globally optimal.',
    },
    onlineAmt: {
      candidateId: 'online-amt-calibrated-v1',
      profileId: 'online-amt-calibration-native-boost-1',
      timingCorrectionMs: -162.93750000004252,
    },
  },
  requestedWorkDeferredBecauseBlocked: {
    robustCpuCudaSemanticParity: 'NOT_RUN_BLOCKED_ON_RUNTIME_FOUNDATION',
    rttCausalRequalification: 'NOT_RUN_BLOCKED_ON_RUNTIME_FOUNDATION',
    transkunStreamingFeasibility: 'NOT_RUN_BLOCKED_ON_RUNTIME_FOUNDATION',
    productionMicrophoneDecisionPolicy: 'NOT_FROZEN_BLOCKED_ON_RUNTIME_FOUNDATION',
    productionMicrophoneEvaluationCandidateRuns: 'NOT_RUN',
  },
  microphoneEvidenceDomain: {
    splits: ['MICROPHONE_DEVELOPMENT', 'MICROPHONE_CALIBRATION', 'MICROPHONE_EVALUATION'],
    genuinePairedMicrophoneTakeCounts: {
      MICROPHONE_DEVELOPMENT: 0,
      MICROPHONE_CALIBRATION: 0,
      MICROPHONE_EVALUATION: 0,
    },
    existingCommittedDevelopmentManifest: {
      path: EMPTY_PAIRED_MANIFEST,
      takeCount: Array.isArray(pairedManifest.takes) ? pairedManifest.takes.length : null,
      status: Array.isArray(pairedManifest.takes) && pairedManifest.takes.length === 0
        ? 'PRODUCTION_MICROPHONE_EVALUATION_DATA_REQUIRED'
        : 'REQUIRES_REVIEW',
    },
    requiredCaptureFields: [
      'microphone WAV',
      'physical MIDI or browser MIDI/capture truth',
      'shared captureSessionId',
      'performer identity',
      'piano/device identity',
      'microphone/device identity',
      'room/placement condition',
      'fixed BPM',
      'PracticeScoreArtifact identity',
      'PracticeScope',
      'source/performance segment boundaries',
      'synchronization evidence',
      'authoritative completion',
    ],
    splitPolicy: 'BLOCKED_NOT_FROZEN: split primarily by performer and recording condition before MICROPHONE_EVALUATION is unsealed.',
  },
  runtimeEligibility: {
    'bytedance-robust-augmented-calibrated-v1': {
      status: 'NOT_EVALUATED_BLOCKED_ON_RUNTIME_FOUNDATION',
      reason: 'No production ContinuousAcousticSession / persistent runtime boundary is wired into Practice.',
    },
    'online-amt-calibrated-v1': {
      status: 'NOT_EVALUATED_BLOCKED_ON_RUNTIME_FOUNDATION',
      reason: 'No production ContinuousAcousticSession / persistent runtime boundary is wired into Practice.',
    },
  },
  productionMicrophoneEvaluationResults: {
    safetyMetricsPerCandidate: 'NOT_EVALUATED',
    sameTakePairedStatisticalComparisons: 'NOT_EVALUATED',
    finalizedFeedbackLatencyMsAndBeats: 'NOT_EVALUATED',
    cpuRamGpuNetworkConcurrency: 'NOT_EVALUATED',
    productionWinner: null,
    productionWinnerStatus: 'NO_PRODUCTION_WINNER_BLOCKED_ON_RUNTIME_FOUNDATION',
  },
  productionRolloutReadiness: {
    status: 'NOT_READY',
    productionMicrophoneUiEnabled: false,
    rolloutPlanNotStarted: true,
  },
  outcome,
  createdAt: new Date().toISOString(),
};

const outRel = 'backend/research/reports/phase9g_c2_production_microphone_precondition_gate_2026-10-12.json';
writeFileSync(path.resolve(repoRoot, outRel), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify({ path: outRel, sha256: fileSha(outRel), outcome }, null, 2));

function evaluatePreconditions({ c1, pairedManifest, productFiles }) {
  return [
    {
      id: 'model_agnostic_continuous_acoustic_session_contract',
      status: productFiles.hasContinuousAcousticSession ? 'PASS' : 'BLOCKED',
      evidence: productFiles.hasContinuousAcousticSession
        ? 'ContinuousAcousticSession symbol found.'
        : 'No ContinuousAcousticSession / ContinuousAcousticPublication production contract symbol found in apps/customer-web/src or backend/app.',
    },
    {
      id: 'browser_chronological_pcm_capture',
      status: productFiles.hasPerformancePcmTimeline ? 'PASS' : 'BLOCKED',
      evidence: productFiles.hasPerformancePcmTimeline
        ? 'performance-pcm-timeline capture helper exists.'
        : 'No browser chronological PCM timeline helper found.',
    },
    {
      id: 'persistent_robust_runtime',
      status: 'BLOCKED',
      evidence: 'Robust finalist currently executes through research/product_benchmark Docker adapter; no product persistent runtime process boundary is wired.',
    },
    {
      id: 'persistent_online_amt_runtime',
      status: 'BLOCKED',
      evidence: 'Online-AMT finalist currently executes through research/product_benchmark Docker adapter; no product persistent runtime process boundary is wired.',
    },
    {
      id: 'segment_aware_pause_resume_behavior',
      status: productFiles.hasSourceSegmentCapture ? 'PARTIAL' : 'BLOCKED',
      evidence: productFiles.hasSourceSegmentCapture
        ? 'PCM timeline tests preserve pause/resume segments, but no production acoustic runtime consumes them.'
        : 'No segment-aware source PCM capture evidence found.',
    },
    {
      id: 'drain_behavior',
      status: productFiles.continuousUnavailable ? 'BLOCKED' : 'UNKNOWN',
      evidence: productFiles.continuousUnavailable
        ? 'use-local-practice.ts still throws Continuous microphone analysis is unavailable.'
        : 'Continuous microphone drain behavior requires manual review.',
    },
    {
      id: 'fail_closed_runtime_semantics',
      status: productFiles.continuousUnavailable ? 'PASS' : 'UNKNOWN',
      evidence: productFiles.continuousUnavailable
        ? 'Practice fails closed with CONTINUOUS_ANALYSIS_UNAVAILABLE instead of manufacturing verdicts.'
        : 'Fail-closed state requires manual review.',
    },
    {
      id: 'development_paired_microphone_midi_capture_tooling',
      status: Array.isArray(pairedManifest.takes) && pairedManifest.takes.length > 0 ? 'PASS' : 'BLOCKED',
      evidence: Array.isArray(pairedManifest.takes) && pairedManifest.takes.length > 0
        ? `Committed DEVELOPMENT paired manifest contains ${pairedManifest.takes.length} takes.`
        : `${EMPTY_PAIRED_MANIFEST} contains 0 takes; genuine product microphone evidence is unavailable.`,
    },
    {
      id: 'phase_9gc1_gate2_foundation',
      status: c1.runtimeValidationSource.productPathOutcome === 'PHASE_9GC_GATE2_BLOCKED' ? 'BLOCKED' : 'PASS',
      evidence: `Phase 9G-C.1 product path outcome: ${c1.runtimeValidationSource.productPathOutcome}.`,
    },
  ];
}

function inspectProductRuntimeFoundation() {
  const searchRoots = ['apps/customer-web/src', 'backend/app'];
  const haystack = searchRoots.flatMap((root) => listTextFiles(path.resolve(repoRoot, root))).map((file) => ({
    file,
    text: readFileSync(file, 'utf8'),
  }));
  const joined = haystack.map((entry) => entry.text).join('\n');
  return {
    hasContinuousAcousticSession: /ContinuousAcousticSession|ContinuousAcousticPublication/.test(joined),
    hasPerformancePcmTimeline: haystack.some((entry) => entry.file.endsWith('performance-pcm-timeline.ts')),
    hasSourceSegmentCapture: /pause\/resume as distinct RUNNING segments|RUNNING segments|source-segment/.test(joined),
    continuousUnavailable: /Continuous microphone analysis is unavailable|CONTINUOUS_ANALYSIS_UNAVAILABLE/.test(joined),
  };
}

function listTextFiles(dir) {
  const out = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop();
    if (!current || !existsSync(current)) continue;
    const entries = readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!['node_modules', '.next', '__pycache__'].includes(entry.name)) stack.push(abs);
      } else if (/\.(ts|tsx|py|mjs|js)$/.test(entry.name)) {
        out.push(abs);
      }
    }
  }
  return out;
}

function verifySealedArtifacts() {
  return Object.fromEntries(Object.entries(SEALED_PHASE_9GB).map(([key, expected]) => {
    const actualSha256 = fileSha(expected.path);
    if (actualSha256 !== expected.sha256) {
      throw new Error(`SEALED_PHASE_9GB_ARTIFACT_SHA_MISMATCH:${expected.path}:expected ${expected.sha256}, got ${actualSha256}`);
    }
    return [key, { ...expected, actualSha256, byteForByteUnchanged: true }];
  }));
}

function readAndVerifyJson(expected) {
  const actualSha256 = fileSha(expected.path);
  if (actualSha256 !== expected.sha256) {
    throw new Error(`ARTIFACT_SHA_MISMATCH:${expected.path}:expected ${expected.sha256}, got ${actualSha256}`);
  }
  return readJson(expected.path);
}

function readJson(rel) {
  return JSON.parse(readFileSync(path.resolve(repoRoot, rel), 'utf8'));
}

function fileSha(rel) {
  return sha256(readFileSync(path.resolve(repoRoot, rel)));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function git(...args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim();
}
