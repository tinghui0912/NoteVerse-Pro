#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repoRoot = process.cwd();
const reportDir = path.resolve(repoRoot, 'backend/research/reports');
mkdirSync(reportDir, { recursive: true });

const SEALED = {
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

const C_REPORTS = {
  disposition: 'backend/research/reports/phase9g_c_post_blind_product_disposition_2026-10-12.json',
  feedbackBeats: 'backend/research/reports/phase9g_c_post_blind_feedback_age_beats_2026-10-12.json',
  gate2Runtime: 'backend/research/reports/phase9g_c_gate2_runtime_validation_2026-10-12.json',
};

const REAL_PIANO_CANDIDATE = 'backend/data/work/public_proxy/vienna-4x22/audio-extracted/audio/Chopin_Ballade/Chopin_op38_p07.wav';

const sealedStatus = Object.fromEntries(
  Object.entries(SEALED).map(([key, expected]) => {
    const bytes = readFileSync(path.resolve(repoRoot, expected.path));
    const actual = sha256(bytes);
    if (actual !== expected.sha256) {
      throw new Error(`SEALED_AUDIT_ARTIFACT_SHA_MISMATCH:${expected.path}:expected ${expected.sha256}, got ${actual}`);
    }
    return [key, { ...expected, actualSha256: actual, byteForByteUnchanged: true }];
  }),
);

const disposition = readJson(C_REPORTS.disposition);
const feedbackBeats = readJson(C_REPORTS.feedbackBeats);
const gate2Runtime = readJson(C_REPORTS.gate2Runtime);

const realPianoFixture = locateRealNonBlindPianoFixture();
const payload = {
  schemaVersion: 1,
  artifact: 'phase9g_c1_audit_history_and_runtime_boundary',
  phase: '9G-C.1',
  sealedReplacementReceiptIdentity: sealedStatus.replacementReceipt,
  phase9gBProtocolExceptionHistory: {
    attempt1ArtifactsPreservedByteForByte: {
      result: sealedStatus.attempt1Result,
      executionReceipt: sealedStatus.attempt1Receipt,
      invalidation: sealedStatus.attempt1Invalidation,
    },
    attempt1Classification: 'INVALIDATED_INFRASTRUCTURE_ABORT_NO_SCIENTIFIC_RESULT',
    attempt1KnownTerminalState: 'ATTEMPT_OUTCOME_UNKNOWN_AFTER_POSSIBLE_MODEL_INFERENCE_BEFORE_SUCCESSFUL_EVIDENCE_SEALING',
    replacementRunClassification: 'EXPLICITLY_RECORDED_PROTOCOL_EXCEPTION',
    replacementScientificConclusion: {
      benchmarkOutcome: disposition.officialScientificConclusion.benchmarkOutcome,
      winner: disposition.officialScientificConclusion.winner,
      sourceResultSha256: sealedStatus.replacementResult.sha256,
      sourceReceiptSha256: sealedStatus.replacementReceipt.sha256,
    },
    strictOriginalOneShotNoRetryComplianceClaimed: false,
    noReportClaimsStrictOriginalOneShotNoRetryCompliance: true,
    exceptionDoesNotAuthorizeAnyAdditionalBlindInference: true,
    p15p22InferenceIncrease: 0,
  },
  postBlindProductDisposition: disposition.productEngineeringDisposition,
  derivedFeedbackAgeBeatsReport: {
    path: C_REPORTS.feedbackBeats,
    sha256: fileSha(C_REPORTS.feedbackBeats),
    correction: feedbackBeats.correction,
  },
  productionShapedVerticalPath: {
    targetPath: [
      'browser PCM',
      'authenticated backend streaming boundary using existing session cookie auth',
      'persistent acoustic runtime process',
      'model-agnostic CandidatePublication stream',
      'existing ContinuousFinalizationLedger evaluator',
      'immutable finalized feedback',
    ],
    actualRepositoryBoundaryFound: gate2Runtime.architectureBoundary.finding,
    existingBackendConvention: {
      framework: 'FastAPI',
      existingRealtimeBoundary: 'backend/app/modules/realtime/router.py uses authenticated SSE under /realtime/events',
      existingAuthentication: 'backend/app/api/deps.py get_current_user resolves the HttpOnly session cookie',
      noNewAuthenticationSubsystemIntroduced: true,
      noNewInfrastructureSubsystemIntroduced: true,
      noCryptographicReceiptsOrAuthoritiesIntroduced: true,
    },
    currentImplementationStatus: 'VERTICAL_PATH_NOT_PRODUCTION_WIRED',
    reason: 'The repository has no existing production Continuous microphone acoustic runtime boundary; current finalist execution remains a research/product_benchmark Docker adapter path.',
    failureStateConstraint: {
      requiredIfIntegrated: 'Expose an orthogonal acoustic analysis/session status for unavailable or incomplete analysis.',
      forbidden: [
        'do not add a new acoustic per-strike verdict',
        'do not translate missing analysis coverage into MISSING',
        'do not mutate finalized verdicts',
        'do not create a second scorer or evaluator',
      ],
    },
  },
  persistentRuntimeStateOwnership: {
    modelProcessLifetime: {
      robust: 'Weights may remain resident in a persistent CUDA worker process across acoustic sessions.',
      onlineAmt: 'Weights may remain resident in a persistent Online-AMT worker process across acoustic sessions.',
    },
    acousticSessionLifetime: {
      robust: 'Session owns source-segment boundaries and publication stream; closing the session releases mutable session buffers.',
      onlineAmt: 'Session owns streaming state container; closing the session resets all mutable recurrent state.',
    },
    sourceSegmentLifetime: {
      robust: 'No inference window may cross pause/resume or invalid source-segment boundaries.',
      onlineAmt: 'Recurrent state persists only across chronological hops inside one RUNNING source segment and resets on pause/resume boundaries.',
    },
    mutableStateLeakageAllowedBetweenSessions: false,
  },
  onlineAmtFrozenTimingIdentity: {
    timingCorrectionMs: -162.93750000004252,
    historicalMinus158MsUsed: false,
  },
  telemetryIntegrity: {
    measured: {
      wallClock: 'MEASURED',
      modelInferenceLatency: 'MEASURED_FROM_CANDIDATE_PUBLICATION_DIAGNOSTICS_WHERE_AVAILABLE',
      queueDelay: 'MEASURED_FROM_CANDIDATE_PUBLICATION_DIAGNOSTICS_WHERE_AVAILABLE',
      publicationRate: 'MEASURED_FROM_PUBLICATION_COUNT_AND_SCENARIO_DURATION',
      publicationDelay: 'MEASURED_FROM_CANDIDATE_PUBLICATION_DIAGNOSTICS_WHERE_AVAILABLE',
      dockerImageIdentity: 'MEASURED',
      runtimeDevice: 'MEASURED',
    },
    notMeasured: {
      cpuUtilization: 'NOT_MEASURED: no trusted per-process sampler was attached to the Docker/runtime process during 9G-C.',
      ramUtilization: 'NOT_MEASURED: no trusted per-process memory sampler was attached during 9G-C.',
      gpuUtilization: 'NOT_MEASURED: CUDA availability/device identity was probed, but no trusted utilization sampler was attached.',
      gpuMemoryUtilization: 'NOT_MEASURED: no trusted VRAM sampler was attached during the finalist runtime validation.',
      networkThroughput: 'NOT_MEASURED: current Docker adapter path uses local filesystem/stdio-style execution rather than a production network streaming boundary.',
    },
  },
  realNonBlindPianoFixture: realPianoFixture,
  runtimeValidationSource: {
    path: C_REPORTS.gate2Runtime,
    sha256: fileSha(C_REPORTS.gate2Runtime),
    productPathOutcome: gate2Runtime.productPathOutcome,
    finalistRuntimeStatus: gate2Runtime.finalistRuntimeStatus,
  },
  blindClosure: {
    phase9gBClosed: true,
    noBlindRerun: true,
    p15p22InferenceIncrease: 0,
    sealedReplacementResultUnmodified: sealedStatus.replacementResult.byteForByteUnchanged,
    sealedReplacementReceiptUnmodified: sealedStatus.replacementReceipt.byteForByteUnchanged,
  },
  createdAt: new Date().toISOString(),
};

const outRel = 'backend/research/reports/phase9g_c1_audit_history_and_runtime_boundary_2026-10-12.json';
writeFileSync(path.resolve(repoRoot, outRel), JSON.stringify(payload, null, 2));
console.log(JSON.stringify({ path: outRel, sha256: fileSha(outRel), outcome: gate2Runtime.productPathOutcome }, null, 2));

function locateRealNonBlindPianoFixture() {
  const abs = path.resolve(repoRoot, REAL_PIANO_CANDIDATE);
  if (!existsSync(abs)) {
    return {
      status: 'REAL_NONBLIND_PIANO_RUNTIME_FIXTURE_REQUIRED',
      reason: 'No committed DEVELOPMENT/CALIBRATION p01-p14 real piano WAV was available at the expected Vienna path.',
    };
  }
  const bytes = readFileSync(abs);
  const wav = parseWavHeader(bytes);
  return {
    status: 'FOUND',
    split: 'CALIBRATION',
    performerId: 'p07',
    sourceAudioPath: REAL_PIANO_CANDIDATE,
    sourceAudioSha256: sha256(bytes),
    byteSize: bytes.length,
    nativeSampleRateHz: wav.sampleRateHz,
    channelCount: wav.channelCount,
    durationMs: wav.durationMs,
    p15p22Used: false,
  };
}

function parseWavHeader(bytes) {
  if (bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
    throw new Error('REAL_NONBLIND_FIXTURE_NOT_WAV');
  }
  let offset = 12;
  let sampleRateHz = null;
  let channelCount = null;
  let bitsPerSample = null;
  let dataBytes = null;
  while (offset + 8 <= bytes.length) {
    const id = bytes.toString('ascii', offset, offset + 4);
    const size = bytes.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (id === 'fmt ') {
      channelCount = bytes.readUInt16LE(dataOffset + 2);
      sampleRateHz = bytes.readUInt32LE(dataOffset + 4);
      bitsPerSample = bytes.readUInt16LE(dataOffset + 14);
    } else if (id === 'data') {
      dataBytes = size;
    }
    offset = dataOffset + size + (size % 2);
  }
  if (!sampleRateHz || !channelCount || !bitsPerSample || dataBytes === null) {
    throw new Error('REAL_NONBLIND_FIXTURE_WAV_METADATA_INCOMPLETE');
  }
  return {
    sampleRateHz,
    channelCount,
    durationMs: (dataBytes / (channelCount * (bitsPerSample / 8)) / sampleRateHz) * 1000,
  };
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
