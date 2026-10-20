#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { performance } from 'node:perf_hooks';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  CANDIDATE_CONFIGS,
  createCandidateAdapter,
  dockerImageIdentity,
  probeCudaDockerRuntime,
} from './candidate-adapters.mjs';
import { getCandidateDefinition } from './score-and-compare.mjs';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);
const bakeoffModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/continuous-analyzer-bakeoff.ts'));

const OFFICIAL_RESULT_PATH = 'backend/research/reports/phase9g_b3_official_product_blind_replacement_result_2026-10-11.json';
const OFFICIAL_RECEIPT_PATH = 'backend/research/reports/phase9g_b3_official_product_blind_replacement_execution_receipt_2026-10-11.json';
const OFFICIAL_RESULT_SHA = '8dba0ef149dcf6f5c995f8ab4e07df85a41b48b81bd2323d8dc39e1b67e8c706';
const OFFICIAL_RECEIPT_SHA = '42a92eab2dca96de328aefa786283c6dcae477ba155775b54caea4964e2ee0eb';
const OFFICIAL_PROJECTION_PATH = 'backend/data/work/phase9gb_official_blind_restart_truth_free_projection_20261011T143145Z.json';
const OFFICIAL_RUN_DIR = 'backend/data/work/phase9gb_official_blind_restart_20261011T143145Z';

const ROBUST_ID = 'bytedance-robust-augmented-calibrated-v1';
const ONLINE_ID = 'online-amt-calibrated-v1';
const ORIGINAL_ID = 'bytedance-original-calibrated-v1';

const reportDir = path.resolve(repoRoot, 'backend/research/reports');
mkdirSync(reportDir, { recursive: true });

const resultBytes = readFileSync(path.resolve(repoRoot, OFFICIAL_RESULT_PATH));
const receiptBytes = readFileSync(path.resolve(repoRoot, OFFICIAL_RECEIPT_PATH));
assertSha(OFFICIAL_RESULT_PATH, resultBytes, OFFICIAL_RESULT_SHA);
assertSha(OFFICIAL_RECEIPT_PATH, receiptBytes, OFFICIAL_RECEIPT_SHA);

const officialResult = JSON.parse(resultBytes.toString('utf8'));
const officialReceipt = JSON.parse(receiptBytes.toString('utf8'));
const projection = JSON.parse(readFileSync(path.resolve(repoRoot, OFFICIAL_PROJECTION_PATH), 'utf8'));

const disposition = buildDisposition();
const feedbackBeatReport = buildFeedbackBeatReport();
const runtimeReport = await runRuntimeValidation();

writeJson('phase9g_c_post_blind_product_disposition_2026-10-12.json', disposition);
writeJson('phase9g_c_post_blind_feedback_age_beats_2026-10-12.json', feedbackBeatReport);
writeJson('phase9g_c_gate2_runtime_validation_2026-10-12.json', runtimeReport);

console.log(JSON.stringify({
  dispositionPath: 'backend/research/reports/phase9g_c_post_blind_product_disposition_2026-10-12.json',
  feedbackBeatPath: 'backend/research/reports/phase9g_c_post_blind_feedback_age_beats_2026-10-12.json',
  runtimePath: 'backend/research/reports/phase9g_c_gate2_runtime_validation_2026-10-12.json',
  gate2Outcome: runtimeReport.productPathOutcome,
  robustStatus: runtimeReport.finalistRuntimeStatus[ROBUST_ID].status,
  onlineStatus: runtimeReport.finalistRuntimeStatus[ONLINE_ID].status,
}, null, 2));

function buildDisposition() {
  return {
    schemaVersion: 1,
    artifact: 'phase9g_c_post_blind_product_disposition',
    phase: '9G-C',
    officialScientificConclusion: {
      sourceResultPath: OFFICIAL_RESULT_PATH,
      sourceResultSha256: OFFICIAL_RESULT_SHA,
      sourceReceiptPath: OFFICIAL_RECEIPT_PATH,
      sourceReceiptSha256: OFFICIAL_RECEIPT_SHA,
      benchmarkOutcome: officialResult.benchmarkOutcome,
      winner: officialResult.winner,
      interpretation: 'The sealed Phase 9G-B statistical benchmark remains STATISTICAL_TIE with winner null.',
    },
    productEngineeringDisposition: {
      [ROBUST_ID]: {
        role: 'PRIMARY_PRODUCT_VALIDATION_CANDIDATE',
        rationale: [
          'highest expectedStrikeRecall',
          'highest verdictAgreementRate',
          'highest chordExactCompletenessRate',
          'highest extraPrecision',
          'missing/wrong false-correct safety close to conservative Online-AMT',
          'substantially safer than ByteDance Original',
          'substantially lower feedback latency than ByteDance Original',
        ],
      },
      [ONLINE_ID]: {
        role: 'SAFETY_LATENCY_REFERENCE_AND_FALLBACK_FINALIST',
        rationale: [
          'lowest incomplete-chord false-complete rate',
          'conservative missing/wrong safety',
          'lowest finalized feedback latency',
          'true streaming architecture',
        ],
      },
      [ORIGINAL_ID]: {
        role: 'BLIND_EVALUATED_RESEARCH_REFERENCE_RETIRED_FROM_V1_PRODUCT_PATH',
        rationale: [
          'historical evidence preserved',
          'not active for v1 product runtime integration without future explicit product decision',
        ],
      },
      'Transkun V2 Aug': { role: 'RESEARCH_REFERENCE_ONLY_NOT_EXECUTED' },
      'Aria-AMT': { role: 'RESEARCH_REFERENCE_ONLY_NOT_EXECUTED' },
      RTT: { role: 'RESEARCH_REFERENCE_ONLY_NOT_EXECUTED' },
      D3RM: { role: 'BLOCKED' },
    },
    explicitNonClaim: 'Robust is not the blind benchmark winner; it is the post-blind product engineering primary finalist.',
    productionMicrophoneEnabled: false,
    createdAt: new Date().toISOString(),
  };
}

function buildFeedbackBeatReport() {
  const projectionById = new Map(projection.scenarios.map((scenario) => [scenario.scenarioId, scenario]));
  const truthPayload = JSON.parse(readFileSync(path.resolve(repoRoot, 'backend/research/reports/phase9g_b_blind_truth_only_scenarios_2026-10-09.json'), 'utf8'));
  const truthById = new Map((truthPayload.scenarios ?? []).map((scenario) => [scenario.scenarioId, scenario]));
  const candidateReports = {};
  for (const candidateId of [ORIGINAL_ID, ONLINE_ID, ROBUST_ID]) {
    const samplesMs = [];
    const samplesBeats = [];
    const definition = getCandidateDefinition(candidateId);
    for (const row of officialReceipt.evidenceRows.filter((entry) => entry.candidateId === candidateId && entry.status === 'SUCCESS')) {
      const evidencePath = path.resolve(repoRoot, OFFICIAL_RUN_DIR, 'evidence', row.fileName);
      const evidence = JSON.parse(readFileSync(evidencePath, 'utf8'));
      const scenario = projectionById.get(row.scenarioId);
      const bpm = scenario?.fixedBpm;
      if (!Number.isFinite(bpm) || bpm <= 0) throw new Error(`BPM_MISSING_FOR_FEEDBACK_BEATS:${row.scenarioId}`);
      const scoreTruth = truthById.get(row.scenarioId);
      if (!scoreTruth) throw new Error(`TRUTH_SCENARIO_MISSING_FOR_FEEDBACK_BEATS:${row.scenarioId}`);
      const score = bakeoffModule.scoreCandidate(scoreTruth, definition, evidence.candidateRun);
      for (const ageMs of score.metricSamples?.finalizedFeedbackAgesMs ?? []) {
        if (!Number.isFinite(ageMs) || ageMs < 0) continue;
        samplesMs.push(ageMs);
        samplesBeats.push(ageMs / (60000 / bpm));
      }
    }
    const official = officialResult.metricSummary[candidateId];
    candidateReports[candidateId] = {
      source: 'SEALED_CANDIDATE_SCENARIO_RUN_SCORECANDIDATE_FINALIZED_FEEDBACK_SAMPLES_AND_STAGE_A_PROJECTION_BPM',
      sampleCount: samplesMs.length,
      officialFinalizedFeedbackAgeP50Ms: official.finalizedFeedbackAgeP50Ms,
      officialFinalizedFeedbackAgeP95Ms: official.finalizedFeedbackAgeP95Ms,
      derivedFeedbackAgeP50Ms: measured(percentile(samplesMs, 0.5), samplesMs.length),
      derivedFeedbackAgeP95Ms: measured(percentile(samplesMs, 0.95), samplesMs.length),
      derivedFeedbackAgeP50Beats: measured(percentile(samplesBeats, 0.5), samplesBeats.length),
      derivedFeedbackAgeP95Beats: measured(percentile(samplesBeats, 0.95), samplesBeats.length),
    };
  }
  return {
    schemaVersion: 1,
    artifact: 'phase9g_c_post_blind_feedback_age_beats',
    phase: '9G-C',
    sourceResultPath: OFFICIAL_RESULT_PATH,
    sourceResultSha256: OFFICIAL_RESULT_SHA,
    correction: 'The sealed official result is not modified. This derived report uses fixed BPM from the verified Stage A truth-free projection because the original Stage B beat helper looked for BPM in the wrong truth-object location.',
    candidates: candidateReports,
    acousticInferenceExecuted: false,
    p15p22CandidateInferenceExecuted: false,
    createdAt: new Date().toISOString(),
  };
}

async function runRuntimeValidation() {
  const runRoot = path.resolve(repoRoot, 'backend/data/work/phase9gc_gate2_runtime');
  mkdirSync(runRoot, { recursive: true });
  const wavPath = path.resolve(runRoot, 'phase9gc_gate2_sustained_p01.wav');
  const wav = createSyntheticWavBuffer(48, 440, 16000);
  writeFileSync(wavPath, wav);
  const wavSha = sha256Buffer(wav);
  const scenario = {
    schemaVersion: 1,
    scenarioId: 'phase9gc-gate2-development-p01-sustained-30s',
    performerId: 'p01',
    pieceId: 'synthetic-runtime-fixture',
    fixedBpm: 120,
    source: {
      sourceAudioPath: path.relative(repoRoot, wavPath).replace(/\\/g, '/'),
      sourceAudioSha256: wavSha,
    },
    audio: {
      sourceAudioPath: path.relative(repoRoot, wavPath).replace(/\\/g, '/'),
      sourceAudioSha256: wavSha,
      nativeSampleRateHz: 16000,
      channelPolicy: 'MONO',
      clipStartMs: 0,
      clipEndMs: 48000,
      sourceDurationMs: 48000,
      performanceOriginSourceMs: 10000,
    },
    completion: { performanceTimeMs: 30000 },
    candidateEligibility: {
      [ROBUST_ID]: true,
      [ONLINE_ID]: true,
    },
  };

  const shortScenario = {
    ...scenario,
    scenarioId: 'phase9gc-gate2-development-p01-startup-6s',
    completion: { performanceTimeMs: 6000 },
  };

  const runtimeMeasurements = {};
  for (const candidateId of [ROBUST_ID, ONLINE_ID]) {
    const adapter = createCandidateAdapter(candidateId);
    const cfg = CANDIDATE_CONFIGS[candidateId];
    const cold = await timedRun(adapter, shortScenario, candidateId, 'cold-start-short');
    const warm = await timedRun(adapter, shortScenario, candidateId, 'warm-start-short');
    const sustained = await timedRun(adapter, scenario, candidateId, 'sustained-30s');
    runtimeMeasurements[candidateId] = summarizeRuntime(candidateId, cfg, { cold, warm, sustained });
  }

  const architectureBoundary = {
    inspectedFiles: [
      'apps/customer-web/src/hooks/practice/use-local-practice.ts',
      'apps/customer-web/src/lib/practice/acoustic-inference/README.md',
      'apps/customer-web/src/lib/practice/practice-architecture-boundaries.test.ts',
      'backend/research/product_benchmark/candidate-adapters.mjs',
      'apps/customer-web/src/lib/practice/research/continuous-paired-take-corpus.ts',
    ],
    finding: 'Continuous microphone analysis is explicitly unavailable in customer-web; historical browser ByteDance worker code is documented as not the authoritative Practice v2 acoustic architecture. The executable acoustic model boundary currently present for these finalists is the research/product_benchmark Docker adapter path, not a production Practice runtime.',
    productClockBoundaryPreserved: true,
    productionMicrophoneEnabled: false,
  };

  const finalistRuntimeStatus = {
    [ROBUST_ID]: classifyRuntime(runtimeMeasurements[ROBUST_ID], architectureBoundary),
    [ONLINE_ID]: classifyRuntime(runtimeMeasurements[ONLINE_ID], architectureBoundary),
  };

  const productPathOutcome = decideProductPath(finalistRuntimeStatus);
  return {
    schemaVersion: 1,
    artifact: 'phase9g_c_gate2_runtime_validation',
    phase: '9G-C',
    officialBlindResult: {
      benchmarkOutcome: officialResult.benchmarkOutcome,
      winner: officialResult.winner,
      sourceResultSha256: OFFICIAL_RESULT_SHA,
      sourceReceiptSha256: OFFICIAL_RECEIPT_SHA,
    },
    runtimeFixture: {
      split: 'DEVELOPMENT',
      performerId: 'p01',
      sourceAudioPath: path.relative(repoRoot, wavPath).replace(/\\/g, '/'),
      sourceAudioSha256: wavSha,
      durationMs: 48000,
      performanceOriginSourceMs: 10000,
      sustainedCompletionMs: 30000,
      p15p22Used: false,
    },
    architectureBoundary,
    dockerImageIdentityByCandidate: {
      [ROBUST_ID]: dockerImageIdentity(CANDIDATE_CONFIGS[ROBUST_ID]),
      [ONLINE_ID]: dockerImageIdentity(CANDIDATE_CONFIGS[ONLINE_ID]),
    },
    robustCudaProbe: probeCudaDockerRuntime(CANDIDATE_CONFIGS[ROBUST_ID]),
    runtimeMeasurements,
    resourceMeasurementPolicy: {
      wallClockAndCandidatePublicationTimings: 'MEASURED',
      cpuRamGpuUtilization: 'NOT_MEASURED_BY_CURRENT_RESEARCH_ADAPTER_NO_SAMPLER_ATTACHED',
      note: 'Docker image/device identity and CUDA availability are recorded. Per-process CPU/RAM/GPU telemetry requires an additional sampler before production acceptance.',
    },
    finalistRuntimeStatus,
    productPathOutcome,
    microphoneAcceptanceReadiness: {
      pairedCorpusPath: 'apps/customer-web/src/lib/practice/research/continuous-paired-take-corpus.ts',
      pairedCorpusFinding: 'Schema and importer exist for same-take microphone audio plus same-take physical MIDI/capture truth. No sufficient native product capture corpus was found in committed fixtures; backend/research/fixtures/continuous_paired_take_manifest_v2_empty_development_2026-10-08.json is empty.',
      requiredDataCapture: [
        'same-take microphone WAV',
        'same-take physical MIDI or browser capture event log',
        'PracticeScoreArtifact identity',
        'fixed BPM tempo selection',
        'PracticeScope',
        'source/performance segment boundaries',
        'capture synchronization evidence',
      ],
      productionMicrophoneEnabled: false,
    },
    p15p22CandidateInferenceIncrease: 0,
    noBlindRerun: true,
    createdAt: new Date().toISOString(),
  };
}

async function timedRun(adapter, scenario, candidateId, label) {
  const started = performance.now();
  const candidateRun = await adapter.runInference(scenario, { executionMode: 'DOCKER', timeoutMs: 300000 });
  const ended = performance.now();
  const publications = candidateRun.publications ?? [];
  const publicationAges = publications
    .flatMap((publication) => (publication.observations ?? []).map((observation) => publication.availabilityTimeMs - observation.performanceTimeMs))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const publicationDelays = publications
    .map((publication) => publication.publicationDelayMs
      ?? publication.candidatePublicationDelayMs
      ?? publication.diagnostics?.publicationDelayMs
      ?? publication.diagnostics?.totalPublicationDelayMs)
    .filter(Number.isFinite);
  const inferenceLatencies = publications
    .map((publication) => publication.inferenceLatencyMs
      ?? publication.candidateProcessingLatencyMs
      ?? publication.diagnostics?.inferenceLatencyMs
      ?? publication.diagnostics?.modelInferenceLatencyMs
      ?? publication.diagnostics?.candidateProcessingLatencyMs)
    .filter(Number.isFinite);
  const queueDelays = publications
    .map((publication) => publication.queueDelayMs ?? publication.diagnostics?.queueDelayMs)
    .filter(Number.isFinite);
  const analyzedThrough = publications
    .map((publication) => publication.analyzedThroughPerformanceMs)
    .filter(Number.isFinite);
  return {
    label,
    candidateId,
    wallClockMs: ended - started,
    scenarioCompletionMs: scenario.completion.performanceTimeMs,
    realTimeFactor: (ended - started) / scenario.completion.performanceTimeMs,
    publicationCount: publications.length,
    observationCount: publications.reduce((sum, publication) => sum + (publication.observations?.length ?? 0), 0),
    runtime: candidateRun.runProvenance?.runtime,
    maxAnalyzedThroughPerformanceMs: analyzedThrough.length ? Math.max(...analyzedThrough) : null,
    terminalCoverageReached: analyzedThrough.length ? Math.max(...analyzedThrough) >= scenario.completion.performanceTimeMs - 1e-9 : false,
    inferenceLatencyMs: pSummary(inferenceLatencies),
    queueDelayMs: pSummary(queueDelays),
    publicationDelayMs: pSummary(publicationDelays),
    finalizedFeedbackAgeMs: pSummary(publicationAges),
  };
}

function summarizeRuntime(candidateId, cfg, runs) {
  const sustained = runs.sustained;
  const backlogBounded = sustained.realTimeFactor <= 1
    && sustained.terminalCoverageReached
    && (sustained.queueDelayMs.p95 ?? 0) < sustained.scenarioCompletionMs;
  return {
    candidateId,
    profileId: cfg.profileId,
    configurationSha256: cfg.identity.configurationSha256,
    checkpointSha256: cfg.checkpoint.sha256,
    targetDevice: cfg.targetDevice ?? 'cpu',
    runtimeIdentity: cfg.runtimeIdentity,
    coldStartupTimeMs: runs.cold.wallClockMs,
    warmStartupTimeMs: runs.warm.wallClockMs,
    runs,
    sustainedBacklogAssessment: {
      status: backlogBounded ? 'NO_UNBOUNDED_BACKLOG_IN_30S_FIXTURE' : 'BACKLOG_OR_COVERAGE_RISK_IN_30S_FIXTURE',
      realTimeFactor: sustained.realTimeFactor,
      terminalCoverageReached: sustained.terminalCoverageReached,
      queueDelayP95Ms: sustained.queueDelayMs.p95,
    },
  };
}

function classifyRuntime(measurement, architectureBoundary) {
  const sustained = measurement.sustainedBacklogAssessment.status === 'NO_UNBOUNDED_BACKLOG_IN_30S_FIXTURE';
  const architectureAvailable = false;
  return {
    status: sustained && architectureAvailable ? 'RUNTIME_FEASIBLE' : 'RUNTIME_BLOCKED',
    measuredDockerRuntimeCanKeepUpOnFixture: sustained,
    blockingReason: architectureAvailable
      ? null
      : 'NO_EXISTING_PRODUCT_CONTINUOUS_MICROPHONE_ACOUSTIC_RUNTIME_BOUNDARY_FOR_THIS_MODEL_FAMILY',
    architectureFinding: architectureBoundary.finding,
  };
}

function decideProductPath(statuses) {
  const robustFeasible = statuses[ROBUST_ID].status === 'RUNTIME_FEASIBLE';
  const onlineFeasible = statuses[ONLINE_ID].status === 'RUNTIME_FEASIBLE';
  if (robustFeasible && onlineFeasible) return 'PHASE_9GC_GATE2_READY_FOR_MICROPHONE_ACCEPTANCE_WITH_TWO_FINALISTS';
  if (robustFeasible) return 'PHASE_9GC_GATE2_READY_FOR_MICROPHONE_ACCEPTANCE_ROBUST_PRIMARY';
  if (onlineFeasible) return 'PHASE_9GC_GATE2_READY_FOR_MICROPHONE_ACCEPTANCE_ONLINE_PRIMARY';
  return 'PHASE_9GC_GATE2_BLOCKED';
}

function createSyntheticWavBuffer(durationSec, freqHz, sampleRateHz) {
  const sampleCount = Math.floor(durationSec * sampleRateHz);
  const dataSize = sampleCount * 2;
  const buffer = Buffer.alloc(44 + dataSize);
  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);
  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRateHz, 24);
  buffer.writeUInt32LE(sampleRateHz * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / sampleRateHz;
    const sample = Math.round(Math.sin(2 * Math.PI * freqHz * t) * 10000);
    buffer.writeInt16LE(sample, 44 + i * 2);
  }
  return buffer;
}

function pSummary(values) {
  return {
    sampleCount: values.length,
    p50: percentile(values, 0.5),
    p95: percentile(values, 0.95),
    max: values.length ? Math.max(...values) : null,
  };
}

function percentile(values, p) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];
}

function measured(value, sampleCount) {
  return sampleCount > 0 ? { status: 'MEASURED', sampleCount, value } : { status: 'NOT_EVALUATED', sampleCount: 0 };
}

function writeJson(name, payload) {
  const abs = path.resolve(reportDir, name);
  writeFileSync(abs, JSON.stringify(payload, null, 2));
}

function assertSha(label, bytes, expected) {
  const actual = sha256Buffer(bytes);
  if (actual !== expected) throw new Error(`SEALED_ARTIFACT_SHA_MISMATCH:${label}:expected ${expected}, got ${actual}`);
}

function sha256Buffer(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
