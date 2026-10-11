/**
 * Product-benchmark candidate adapters for Phase 9G-B.3-FIX.
 *
 * This module is intentionally truth-free: it accepts only acoustic/runtime
 * scenario metadata and produces CandidateScenarioRun evidence. Score truth is
 * consumed later by the shared ContinuousFinalizationLedger scorer.
 */

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const repoRoot = process.cwd();
const require = createRequire(import.meta.url);
const { createJiti } = require(path.resolve(repoRoot, 'apps/customer-web/node_modules/jiti'));
const jiti = createJiti(import.meta.url);

const byteDanceModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/bytedance-score-aware-chunked.ts'));
const onlineAmtModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/online-amt-stateful-streaming.ts'));
const qualModule = jiti(path.resolve(repoRoot, 'apps/customer-web/src/lib/practice/research/public-challenger-qualification.ts'));

const REGISTRY_PATH = 'backend/research/reports/phase9g_a32_final_candidate_registry_2026-10-10.json';
const registryBytes = readFileSync(path.resolve(repoRoot, REGISTRY_PATH));
const registry = JSON.parse(registryBytes.toString('utf8'));

export const ACTIVE_CANDIDATE_IDS = [
  'bytedance-original-calibrated-v1',
  'online-amt-calibrated-v1',
  'bytedance-robust-augmented-calibrated-v1',
];

const activeRegistryRecords = new Map(
  registry.candidates
    .filter((candidate) => ACTIVE_CANDIDATE_IDS.includes(candidate.candidateId))
    .map((candidate) => [candidate.candidateId, candidate]),
);

if (activeRegistryRecords.size !== 3) {
  throw new Error(`PRODUCT_BENCHMARK_ACTIVE_REGISTRY_COUNT_MISMATCH:${activeRegistryRecords.size}`);
}

for (const candidate of activeRegistryRecords.values()) {
  qualModule.assertCandidateRegistryIdentitiesExact({
    candidateId: candidate.candidateId,
    candidateFamily: candidate.candidateFamily,
    profileId: candidate.profileId,
    configurationSha256: candidate.configurationSha256,
    checkpointSha256: candidate.checkpointSha256,
  });
}

const FROZEN_EXECUTION_PROFILES = {
  'bytedance-original-calibrated-v1': {
    family: 'bytedance-original',
    strategyKind: 'CHUNKED',
    contextGeometry: {
      profileId: 'CALIBRATED_CONTEXT_5S',
      modelInputMs: 5000,
      nominalOwnedRegionMs: 2500,
      interiorPastContextMs: 1250,
      maximumFutureContextMs: 1250,
      terminalWindowPolicy: 'RIGHT_ANCHORED_TERMINAL_FUTURE_BOUND_V1',
      plannerVersion: 'phase9gb3-fix-bytedance-variable-context-v1',
    },
    thresholds: { onsetThreshold: 0.20, frameThreshold: 0.10 },
    checkpoint: {
      path: 'models/bytedance_piano_transcription/CRNN_note_F1_0.9677_pedal_F1_0.9186.pth',
      bytes: 171966578,
    },
    dockerImage: 'noteverse-bytedance-calibration:phase9ga21',
    dockerScript: 'backend/scripts/run_bytedance_pytorch_raw_batch.py',
    targetDevice: 'cpu',
    sampleRateHz: 16000,
    runtimeIdentity: 'noteverse-bytedance-calibration:phase9ga21',
    preprocessingIdentity: 'deterministic_wav_pcm16_mono_linear_resample_16k_v1',
  },
  'online-amt-calibrated-v1': {
    family: 'online-amt',
    strategyKind: 'STREAMING',
    streaming: {
      sampleRateHz: 16000,
      hopSamples: 512,
      hopMs: 32,
      timingCorrectionMs: -162.9375,
      publishedOnsetBoost: 1.0,
      pseudoIntensityShortcut: 'NATIVE',
    },
    checkpoint: {
      path: 'backend/data/work/online_amt/model-180000.pt',
      bytes: 178804960,
    },
    dockerImage: 'noteverse-online-amt-modern:phase9e-b1',
    dockerScript: 'backend/research/online_amt/run_online_amt_modern_smoke.py',
    targetDevice: 'cpu',
    sampleRateHz: 16000,
    runtimeIdentity: 'noteverse-online-amt-modern:phase9e-b1',
  },
  'bytedance-robust-augmented-calibrated-v1': {
    family: 'bytedance-robust-augmented',
    strategyKind: 'CHUNKED',
    contextGeometry: {
      profileId: 'CALIBRATED_CONTEXT_1820',
      modelInputMs: 1820,
      nominalOwnedRegionMs: 600,
      maximumFutureContextMs: 220,
      terminalWindowPolicy: 'FIXED_1820_RIGHT_ANCHORED_COMMIT_V1',
      plannerVersion: 'phase9gb3-fix-bytedance-1820-v1',
    },
    thresholds: { onsetThreshold: 0.30, frameThreshold: 0.05 },
    checkpoint: {
      path: 'models/bytedance_piano_transcription/high_resolution_MAESTRO_augmentations.pth',
      bytes: 103815845,
    },
    dockerImage: 'noteverse-challengers:phase9ga3',
    dockerScript: 'backend/scripts/run_bytedance_robust_pytorch_raw_batch.py',
    targetDevice: 'cpu',
    sampleRateHz: 16000,
    runtimeIdentity: 'noteverse-challengers:phase9ga3',
    preprocessingIdentity: 'deterministic_wav_pcm16_mono_linear_resample_16k_v1',
  },
};

export const CANDIDATE_CONFIGS = Object.fromEntries(ACTIVE_CANDIDATE_IDS.map((candidateId) => {
  const registryRecord = activeRegistryRecords.get(candidateId);
  const execution = FROZEN_EXECUTION_PROFILES[candidateId];
  return [candidateId, {
    candidateId,
    candidateFamily: registryRecord.candidateFamily,
    family: execution.family,
    profileId: registryRecord.profileId,
    strategyKind: execution.strategyKind,
    identity: {
      configurationSha256: registryRecord.configurationSha256,
      modelCheckpointSha256: registryRecord.checkpointSha256,
      trainingDataOverlapStatus: registryRecord.trainingDataOverlapStatus ?? 'UNKNOWN',
      registryPath: REGISTRY_PATH,
      registrySha256: sha256Buffer(registryBytes),
    },
    ...execution,
    checkpoint: {
      ...execution.checkpoint,
      sha256: registryRecord.checkpointSha256,
    },
  }];
}));

export function assertActiveCandidateRegistryIdentitiesExact() {
  for (const candidateId of ACTIVE_CANDIDATE_IDS) {
    const cfg = CANDIDATE_CONFIGS[candidateId];
    qualModule.assertCandidateRegistryIdentitiesExact({
      candidateId,
      candidateFamily: cfg.candidateFamily,
      profileId: cfg.profileId,
      configurationSha256: cfg.identity.configurationSha256,
      checkpointSha256: cfg.checkpoint.sha256,
    });
  }
}

export function assertTruthIsolation(scenario) {
  const forbidden = [
    'expectedStrikes',
    'expectedEvents',
    'physicalGroundTruth',
    'referenceMidi',
    'sourceMidiPath',
    'sourceMidiSha256',
    'notes',
    'taxonomy',
    'familyTags',
    'counterfactualReceipt',
    'counterfactualMutation',
    'groundTruthStrikes',
    'truthReceipts',
  ];
  for (const key of forbidden) {
    if (scenario?.[key] !== undefined || scenario?.source?.[key] !== undefined) {
      throw new Error(`TRUTH_ISOLATION_VIOLATION:${scenario?.scenarioId ?? 'unknown'}:${key}`);
    }
  }
}

export function planByteDanceVariableContext(scenario, context) {
  const completion = scenario.completion?.performanceTimeMs;
  if (!Number.isFinite(completion) || completion < 0) {
    throw new Error(`BYTE_DANCE_SCENARIO_COMPLETION_REQUIRED:${scenario.scenarioId}`);
  }
  const commitMs = context.nominalOwnedRegionMs;
  const futureMs = context.maximumFutureContextMs;
  const modelInputMs = context.modelInputMs;
  const plans = [];
  let start = 0;
  while (start < completion || (completion === 0 && plans.length === 0)) {
    const end = Math.min(completion, start + commitMs);
    const inputEnd = end + futureMs;
    plans.push({
      chunkId: `${scenario.scenarioId}:${context.profileId}:window-${plans.length.toString().padStart(3, '0')}`,
      scenarioId: scenario.scenarioId,
      commitStartPerformanceMs: start,
      commitEndPerformanceMs: end,
      inputStartPerformanceMs: inputEnd - modelInputMs,
      inputEndPerformanceMs: inputEnd,
      expectedGroupIds: [],
    });
    if (end === completion) break;
    start = end;
  }
  validateByteDancePlans(context, plans, completion);
  return plans;
}

function validateByteDancePlans(context, plans, completion) {
  let previousEnd = 0;
  for (const [index, plan] of plans.entries()) {
    const inputDuration = plan.inputEndPerformanceMs - plan.inputStartPerformanceMs;
    const futureDuration = plan.inputEndPerformanceMs - plan.commitEndPerformanceMs;
    if (Math.abs(inputDuration - context.modelInputMs) > 1e-9) {
      throw new Error(`BYTE_DANCE_INPUT_DURATION_MISMATCH:${context.profileId}:${inputDuration}`);
    }
    if (Math.abs(futureDuration - context.maximumFutureContextMs) > 1e-9) {
      throw new Error(`BYTE_DANCE_FUTURE_CONTEXT_BOUND_MISMATCH:${context.profileId}:${futureDuration}`);
    }
    if (index === 0 && plan.commitStartPerformanceMs !== 0) {
      throw new Error(`BYTE_DANCE_FIRST_COMMIT_MUST_START_AT_ZERO:${context.profileId}`);
    }
    if (plan.commitStartPerformanceMs !== previousEnd || plan.commitEndPerformanceMs < plan.commitStartPerformanceMs) {
      throw new Error(`BYTE_DANCE_COMMIT_OWNERSHIP_NOT_EXACT:${context.profileId}`);
    }
    previousEnd = plan.commitEndPerformanceMs;
  }
  if (Math.abs(previousEnd - completion) > 1e-9) {
    throw new Error(`BYTE_DANCE_COMMIT_DOES_NOT_COVER_COMPLETION:${context.profileId}`);
  }
}

export function verifyPhysicalCheckpointIdentity(config) {
  const checkpointPath = path.resolve(repoRoot, config.checkpoint.path);
  if (!existsSync(checkpointPath)) {
    throw new Error(`CHECKPOINT_FILE_MISSING:${config.candidateId}:${config.checkpoint.path}`);
  }
  const bytes = statSync(checkpointPath).size;
  const sha = sha256Buffer(readFileSync(checkpointPath));
  if (sha !== config.checkpoint.sha256) {
    throw new Error(`CHECKPOINT_SHA_MISMATCH:${config.candidateId}:expected ${config.checkpoint.sha256}, got ${sha}`);
  }
  if (bytes !== config.checkpoint.bytes) {
    throw new Error(`CHECKPOINT_BYTES_MISMATCH:${config.candidateId}:expected ${config.checkpoint.bytes}, got ${bytes}`);
  }
  return { path: checkpointPath, sha256: sha, bytes };
}

export async function verifySourceAudioForScenario(scenario) {
  const rel = scenario.audio?.sourceAudioPath ?? scenario.source?.sourceAudioPath;
  const expectedSha = scenario.audio?.sourceAudioSha256 ?? scenario.source?.sourceAudioSha256;
  if (!rel) throw new Error(`SOURCE_AUDIO_PATH_REQUIRED:${scenario.scenarioId}`);
  if (!expectedSha) throw new Error(`SOURCE_AUDIO_SHA_REQUIRED:${scenario.scenarioId}`);
  const abs = path.resolve(repoRoot, rel);
  if (!existsSync(abs)) throw new Error(`SOURCE_AUDIO_FILE_MISSING:${scenario.scenarioId}:${rel}`);
  const bytes = await readFile(abs);
  const actualSha = sha256Buffer(bytes);
  if (actualSha !== expectedSha) {
    throw new Error(`SOURCE_AUDIO_SHA_MISMATCH:${scenario.scenarioId}:expected ${expectedSha}, got ${actualSha}`);
  }
  const wav = byteDanceModule.decodeResearchWavToMonoFloat32(bytes);
  if (scenario.audio?.nativeSampleRateHz !== undefined && wav.sampleRateHz !== scenario.audio.nativeSampleRateHz) {
    throw new Error(`SOURCE_AUDIO_SAMPLE_RATE_MISMATCH:${scenario.scenarioId}:expected ${scenario.audio.nativeSampleRateHz}, got ${wav.sampleRateHz}`);
  }
  if (scenario.audio?.sourceDurationMs !== undefined && Math.abs(wav.durationMs - scenario.audio.sourceDurationMs) > 2) {
    throw new Error(`SOURCE_AUDIO_DURATION_MISMATCH:${scenario.scenarioId}:expected ${scenario.audio.sourceDurationMs}, got ${wav.durationMs}`);
  }
  return { absolutePath: abs, relativePath: rel, sha256: actualSha, wav, bytes };
}

function sourceWindowInsideAudio(scenario, sourceStartMs, sourceEndMs, wav) {
  if (sourceStartMs < -1e-6 || sourceEndMs > wav.durationMs + 1e-6 || sourceEndMs <= sourceStartMs) {
    throw new Error(`SOURCE_WINDOW_OUTSIDE_AUDIO:${scenario.scenarioId}:${sourceStartMs}..${sourceEndMs} of ${wav.durationMs}`);
  }
}

function windowGeometrySha256(identity) {
  return sha256Json({
    contextProfileId: identity.contextProfileId,
    inputStartSourceMs: identity.inputStartSourceMs,
    inputEndSourceMs: identity.inputEndSourceMs,
    inputSampleRateHz: identity.inputSampleRateHz,
    inputSampleCount: identity.inputSampleCount,
    inputStartPerformanceMs: identity.inputStartPerformanceMs,
    inputEndPerformanceMs: identity.inputEndPerformanceMs,
    commitStartPerformanceMs: identity.commitStartPerformanceMs,
    commitEndPerformanceMs: identity.commitEndPerformanceMs,
  });
}

function buildByteDanceWindowRequest({ config, scenario, plan, audio }) {
  const originMs = scenario.audio.performanceOriginSourceMs;
  const sourceStart = originMs + plan.inputStartPerformanceMs;
  const sourceEnd = originMs + plan.inputEndPerformanceMs;
  sourceWindowInsideAudio(scenario, sourceStart, sourceEnd, audio.wav);
  const identityBase = {
    schemaVersion: 1,
    candidateFamily: config.family,
    checkpointSha256: config.checkpoint.sha256,
    checkpointBytes: config.checkpoint.bytes,
    runtimeIdentity: config.runtimeIdentity,
    contextProfileId: config.contextGeometry.profileId,
    sourceAudioSha256: audio.sha256,
    sourceAudioPath: audio.relativePath,
    inputStartSourceMs: sourceStart,
    inputEndSourceMs: sourceEnd,
    inputStartPerformanceMs: plan.inputStartPerformanceMs,
    inputEndPerformanceMs: plan.inputEndPerformanceMs,
    commitStartPerformanceMs: plan.commitStartPerformanceMs,
    commitEndPerformanceMs: plan.commitEndPerformanceMs,
    inputSampleRateHz: config.sampleRateHz,
    inputSampleCount: Math.round(config.contextGeometry.modelInputMs / 1000 * config.sampleRateHz),
    preprocessingIdentity: config.preprocessingIdentity,
  };
  const identity = {
    ...identityBase,
    windowGeometrySha256: windowGeometrySha256(identityBase),
  };
  return {
    scenarioId: scenario.scenarioId,
    contextProfileId: config.contextGeometry.profileId,
    windowId: plan.chunkId,
    sourceAudioPath: audio.relativePath,
    inputStartSourceMs: sourceStart,
    inputEndSourceMs: sourceEnd,
    inputSampleCount: identity.inputSampleCount,
    identity,
  };
}

function validateByteDanceRawBatch(rawData, requests, config) {
  if (rawData?.schemaVersion !== 1 || !Array.isArray(rawData.chunks)) {
    throw new Error(`BYTEDANCE_RAW_BATCH_SCHEMA_INVALID:${config.candidateId}`);
  }
  if (rawData.checkpointSha256 !== config.checkpoint.sha256) {
    throw new Error(`BYTEDANCE_RAW_CHECKPOINT_SHA_MISMATCH:${config.candidateId}`);
  }
  if (rawData.checkpointBytes !== config.checkpoint.bytes) {
    throw new Error(`BYTEDANCE_RAW_CHECKPOINT_BYTES_MISMATCH:${config.candidateId}`);
  }
  const runtimeImage = typeof rawData.runtimeIdentity === 'string' ? rawData.runtimeIdentity : rawData.runtimeIdentity?.image;
  if (runtimeImage !== config.runtimeIdentity) {
    throw new Error(`BYTEDANCE_RAW_RUNTIME_MISMATCH:${config.candidateId}:expected ${config.runtimeIdentity}, got ${runtimeImage}`);
  }
  const byWindow = new Map();
  for (const chunk of rawData.chunks) {
    if (byWindow.has(chunk.windowId)) throw new Error(`BYTEDANCE_DUPLICATE_RAW_WINDOW:${chunk.windowId}`);
    byWindow.set(chunk.windowId, chunk);
  }
  if (byWindow.size !== requests.length) {
    throw new Error(`BYTEDANCE_RAW_WINDOW_COUNT_MISMATCH:${config.candidateId}:expected ${requests.length}, got ${byWindow.size}`);
  }
  for (const request of requests) {
    const chunk = byWindow.get(request.windowId);
    if (!chunk) throw new Error(`BYTEDANCE_RAW_WINDOW_MISSING:${request.windowId}`);
    if (chunk.scenarioId !== request.scenarioId) throw new Error(`BYTEDANCE_RAW_SCENARIO_MISMATCH:${request.windowId}`);
    if (chunk.contextProfileId !== request.contextProfileId) throw new Error(`BYTEDANCE_RAW_CONTEXT_MISMATCH:${request.windowId}`);
    if (chunk.inputSampleCount !== request.identity.inputSampleCount) throw new Error(`BYTEDANCE_RAW_INPUT_SAMPLE_COUNT_MISMATCH:${request.windowId}`);
    if (!chunk.inputPcmSha256 || !/^[a-f0-9]{64}$/.test(chunk.inputPcmSha256)) throw new Error(`BYTEDANCE_RAW_PCM_SHA_MISSING:${request.windowId}`);
    if (chunk.identity?.windowGeometrySha256 !== request.identity.windowGeometrySha256) throw new Error(`BYTEDANCE_RAW_GEOMETRY_IDENTITY_MISMATCH:${request.windowId}`);
    validateTensorDigest(chunk, 'reg_onset_output', request.windowId);
    validateTensorDigest(chunk, 'frame_output', request.windowId);
  }
  return byWindow;
}

function validateTensorDigest(chunk, key, windowId) {
  const tensor = chunk.rawOutputs?.[key];
  if (!tensor || !Array.isArray(tensor.dims) || !Array.isArray(tensor.data)) {
    throw new Error(`BYTEDANCE_RAW_TENSOR_MISSING:${windowId}:${key}`);
  }
  if (tensor.dims.at(-1) !== 88) throw new Error(`BYTEDANCE_RAW_TENSOR_INVALID_PITCH_DIM:${windowId}:${key}`);
  const expectedLength = tensor.dims.reduce((prod, dim) => prod * dim, 1);
  if (expectedLength !== tensor.data.length) throw new Error(`BYTEDANCE_RAW_TENSOR_LENGTH_MISMATCH:${windowId}:${key}`);
  for (const value of tensor.data) {
    if (!Number.isFinite(value)) throw new Error(`BYTEDANCE_RAW_TENSOR_NONFINITE:${windowId}:${key}`);
  }
  if (!tensor.float32ByteSha256) throw new Error(`BYTEDANCE_RAW_TENSOR_SHA_MISSING:${windowId}:${key}`);
  const recomputed = sha256Float32Array(tensor.data);
  if (recomputed !== tensor.float32ByteSha256) {
    throw new Error(`BYTEDANCE_RAW_TENSOR_SHA_MISMATCH:${windowId}:${key}`);
  }
}

function rawOutputsFromChunk(chunk) {
  return {
    reg_onset_output: Float32Array.from(chunk.rawOutputs.reg_onset_output.data),
    reg_onset_shape: chunk.rawOutputs.reg_onset_output.dims,
    frame_output: Float32Array.from(chunk.rawOutputs.frame_output.data),
    frame_shape: chunk.rawOutputs.frame_output.dims,
  };
}

function buildRunFromByteDanceChunks({ scenario, config, plans, chunkByWindowId, runtime }) {
  const processingLatencyByPlan = new Map();
  const decodedByPlan = new Map();
  for (const plan of plans) {
    const chunk = chunkByWindowId.get(plan.chunkId);
    const latency = chunk?.inferenceLatencyMs ?? 0;
    processingLatencyByPlan.set(plan.chunkId, latency);
    const decoded = byteDanceModule.decodeByteDanceChunkRawOutputs({
      scenario,
      plan,
      raw: rawOutputsFromChunk(chunk),
      inferenceCompletedAtMs: plan.inputEndPerformanceMs + latency,
      onsetThreshold: config.thresholds.onsetThreshold,
      frameThreshold: config.thresholds.frameThreshold,
      allowVariableFrameCount: true,
    });
    decodedByPlan.set(plan.chunkId, decoded);
  }
  const schedule = byteDanceModule.scheduleByteDanceSingleWorkerPublications({
    plans,
    processingLatencyMsByChunkId: processingLatencyByPlan,
  });
  const publications = plans.map((plan) => {
    const timing = schedule.get(plan.chunkId);
    return byteDanceModule.publicationForByteDanceChunk({
      scenario,
      plan,
      observations: observationsForTruthFreeByteDanceChunk(scenario, plan, decodedByPlan.get(plan.chunkId) ?? []),
      inferenceLatencyMs: processingLatencyByPlan.get(plan.chunkId),
      candidateProcessingLatencyMs: processingLatencyByPlan.get(plan.chunkId),
      publicationAvailableAtMs: timing?.inferenceFinishAtMs,
      inferenceStartAtMs: timing?.inferenceStartAtMs,
      queueDelayMs: timing?.queueDelayMs,
    });
  });
  return byteDanceModule.candidateRunForByteDanceChunks({
    candidateId: config.candidateId,
    scenarioId: scenario.scenarioId,
    publications,
    command: `docker run ${config.dockerImage}`,
    runtime,
  });
}

function observationsForTruthFreeByteDanceChunk(scenario, plan, decodedEvents) {
  const isFirst = Math.abs(plan.commitStartPerformanceMs) <= 1e-9;
  return decodedEvents
    .filter((event) => (isFirst ? event.performanceTimeMs >= plan.commitStartPerformanceMs : event.performanceTimeMs > plan.commitStartPerformanceMs)
      && event.performanceTimeMs <= plan.commitEndPerformanceMs)
    .map((event, ordinal) => ({
      observationId: sha256Json({
        scenarioId: scenario.scenarioId,
        chunkId: plan.chunkId,
        eventId: event.eventId,
        pitch: event.pitch,
        performanceTimeMs: event.performanceTimeMs,
        ordinal,
      }).slice(0, 32),
      pitch: event.pitch,
      performanceTimeMs: event.performanceTimeMs,
      confidence: event.confidence,
    }));
}

class ByteDanceBaseAdapter {
  constructor(config) {
    this.config = config;
  }

  async runInference(scenario, options = {}) {
    assertTruthIsolation(scenario);
    const executionMode = options.executionMode ?? 'SYNTHETIC';
    const plans = planByteDanceVariableContext(scenario, this.config.contextGeometry);
    if (executionMode === 'DOCKER') {
      return this._runDockerInference(scenario, plans, options);
    }
    return this._runSyntheticInference(scenario, plans, options);
  }

  async _runDockerInference(scenario, plans, options) {
    verifyPhysicalCheckpointIdentity(this.config);
    const audio = await verifySourceAudioForScenario(scenario);
    const workDir = path.resolve(repoRoot, `backend/data/work/product_benchmark_docker_${this.config.family}`);
    await mkdir(workDir, { recursive: true });
    const windows = plans.map((plan) => buildByteDanceWindowRequest({ config: this.config, scenario, plan, audio }));
    const runHash = createHash('sha256').update(JSON.stringify({ candidateId: this.config.candidateId, scenarioId: scenario.scenarioId, windows })).digest('hex').slice(0, 12);
    const inputPath = path.resolve(workDir, `${this.config.family}_in_${runHash}.json`);
    const outputPath = path.resolve(workDir, `${this.config.family}_out_${runHash}.json`);
    await writeFile(inputPath, JSON.stringify({ windows }, null, 2), 'utf8');

    const dockerArgs = [
      'run', '--rm',
      '--entrypoint', 'python',
      '-v', `${repoRoot}:/workspace`,
      '-w', '/workspace',
      this.config.dockerImage,
      this.config.dockerScript,
      '--input', path.relative(repoRoot, inputPath).replace(/\\/g, '/'),
      '--output', path.relative(repoRoot, outputPath).replace(/\\/g, '/'),
      '--checkpoint', this.config.checkpoint.path,
      '--device', this.config.targetDevice,
      '--runtime-identity', this.config.runtimeIdentity,
    ];
    const run = spawnSync('docker', dockerArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 180000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (run.status !== 0 || !existsSync(outputPath)) {
      throw new Error(`DOCKER_BYTEDANCE_FAILED:${this.config.candidateId}:${run.stderr || run.stdout}`);
    }
    const rawData = JSON.parse(await readFile(outputPath, 'utf8'));
    const chunkByWindowId = validateByteDanceRawBatch(rawData, windows, this.config);
    return buildRunFromByteDanceChunks({
      scenario,
      config: this.config,
      plans,
      chunkByWindowId,
      runtime: `${this.config.runtimeIdentity}:real-pytorch-raw-batch`,
    });
  }

  _runSyntheticInference(scenario, plans, options) {
    const chunkByWindowId = new Map();
    for (const plan of plans) {
      chunkByWindowId.set(plan.chunkId, {
        windowId: plan.chunkId,
        inferenceLatencyMs: options.simulatedLatencyMs ?? 25,
        syntheticPitch: options.syntheticPitch ?? 'C4',
      });
    }
    return buildSyntheticChunkRun({ config: this.config, scenario, plans, chunkByWindowId });
  }
}

function buildSyntheticChunkRun({ config, scenario, plans, chunkByWindowId }) {
  const processingLatencyByPlan = new Map(plans.map((plan) => [plan.chunkId, chunkByWindowId.get(plan.chunkId)?.inferenceLatencyMs ?? 25]));
  const schedule = byteDanceModule.scheduleByteDanceSingleWorkerPublications({ plans, processingLatencyMsByChunkId: processingLatencyByPlan });
  const publications = plans.map((plan) => {
    const timing = schedule.get(plan.chunkId);
    const pitch = chunkByWindowId.get(plan.chunkId)?.syntheticPitch;
    const midpoint = plan.commitStartPerformanceMs + (plan.commitEndPerformanceMs - plan.commitStartPerformanceMs) / 2;
    const observations = pitch ? [{
      observationId: `obs_${plan.chunkId}_0`,
      pitch,
      performanceTimeMs: midpoint,
      confidence: 0.95,
    }] : [];
    return byteDanceModule.publicationForByteDanceChunk({
      scenario,
      plan,
      observations,
      inferenceLatencyMs: processingLatencyByPlan.get(plan.chunkId),
      candidateProcessingLatencyMs: processingLatencyByPlan.get(plan.chunkId),
      publicationAvailableAtMs: timing?.inferenceFinishAtMs,
      inferenceStartAtMs: timing?.inferenceStartAtMs,
      queueDelayMs: timing?.queueDelayMs,
    });
  });
  return byteDanceModule.candidateRunForByteDanceChunks({
    candidateId: config.candidateId,
    scenarioId: scenario.scenarioId,
    publications,
    command: `synthetic ${config.candidateId}`,
    runtime: `synthetic-${config.family}`,
  });
}

export class ByteDanceOriginalAdapter extends ByteDanceBaseAdapter {
  constructor(config = CANDIDATE_CONFIGS['bytedance-original-calibrated-v1']) {
    super(config);
  }
}

export class RobustByteDanceAdapter extends ByteDanceBaseAdapter {
  constructor(config = CANDIDATE_CONFIGS['bytedance-robust-augmented-calibrated-v1']) {
    super(config);
  }
}

export class OnlineAmtStreamingAdapter {
  constructor(config = CANDIDATE_CONFIGS['online-amt-calibrated-v1']) {
    this.config = config;
  }

  async runInference(scenario, options = {}) {
    assertTruthIsolation(scenario);
    const executionMode = options.executionMode ?? 'SYNTHETIC';
    if (executionMode === 'DOCKER') {
      return this._runDockerInference(scenario, options);
    }
    return this._runSyntheticInference(scenario, options);
  }

  async _runDockerInference(scenario, options) {
    verifyPhysicalCheckpointIdentity(this.config);
    const audio = await verifySourceAudioForScenario(scenario);
    const completion = scenario.completion.performanceTimeMs;
    const ownedSamples = Math.floor(completion / 1000 * this.config.streaming.sampleRateHz);
    const tailReq = onlineAmtModule.onlineAmtSegmentTailRequirement(ownedSamples, this.config.streaming.timingCorrectionMs);
    const originMs = scenario.audio.performanceOriginSourceMs;
    const perfEndMs = originMs + completion;
    const tailEndMs = perfEndMs + tailReq.requiredContextTailSamples / this.config.streaming.sampleRateHz * 1000;
    sourceWindowInsideAudio(scenario, originMs, tailEndMs, audio.wav);
    const performancePcm = Array.from(extractResampleLinear({
      sourcePcm: audio.wav.pcm,
      sourceSampleRateHz: audio.wav.sampleRateHz,
      sourceStartMs: originMs,
      sourceEndMs: perfEndMs,
      outputSamples: ownedSamples,
    }));
    const tailPcm = Array.from(extractResampleLinear({
      sourcePcm: audio.wav.pcm,
      sourceSampleRateHz: audio.wav.sampleRateHz,
      sourceStartMs: perfEndMs,
      sourceEndMs: tailEndMs,
      outputSamples: tailReq.requiredContextTailSamples,
    }));
    const segment = {
      segmentId: `${scenario.scenarioId}:segment-0`,
      performanceStartMs: 0,
      performancePcm16k: performancePcm,
      contextTailPcm16k: tailPcm,
    };

    const workDir = path.resolve(repoRoot, 'backend/data/work/product_benchmark_docker_online_amt');
    await mkdir(workDir, { recursive: true });
    const runHash = createHash('sha256').update(JSON.stringify({ scenarioId: scenario.scenarioId, segment, config: this.config.identity.configurationSha256 })).digest('hex').slice(0, 12);
    const inputPath = path.resolve(workDir, `online_amt_in_${runHash}.json`);
    const outputPath = path.resolve(workDir, `online_amt_out_${runHash}.json`);
    await writeFile(inputPath, JSON.stringify({ segments: [segment] }, null, 2), 'utf8');

    const dockerArgs = [
      'run', '--rm',
      '-v', `${repoRoot}:/workspace`,
      '-v', `${path.resolve(repoRoot, 'backend/data/work/online_amt')}:/online_amt`,
      '-w', '/workspace',
      this.config.dockerImage,
      'python3',
      this.config.dockerScript,
      '--online-amt-repo', '/online_amt',
      '--checkpoint', `/workspace/${this.config.checkpoint.path}`,
      '--segment-input', `/workspace/${path.relative(repoRoot, inputPath).replace(/\\/g, '/')}`,
      '--output', `/workspace/${path.relative(repoRoot, outputPath).replace(/\\/g, '/')}`,
      '--pseudo-intensity', this.config.streaming.pseudoIntensityShortcut,
      '--onset-boost', String(this.config.streaming.publishedOnsetBoost),
    ];
    const run = spawnSync('docker', dockerArgs, {
      cwd: repoRoot,
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 180000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (run.status !== 0 || !existsSync(outputPath)) {
      throw new Error(`DOCKER_ONLINE_AMT_FAILED:${run.stderr || run.stdout}`);
    }
    const dockerOutput = JSON.parse(await readFile(outputPath, 'utf8'));
    const hopArtifact = dockerOutput.hopArtifact ?? dockerOutput;
    if (!hopArtifact) {
      throw new Error(`ONLINE_AMT_HOP_ARTIFACT_MISSING:${dockerOutput.assetIdentity?.reason ?? dockerOutput.runtimeSmoke?.reason ?? 'unknown'}`);
    }
    for (const segmentOut of hopArtifact.segments ?? []) {
      for (const hop of segmentOut.hops ?? []) {
        if (!Array.isArray(hop.pitchStates) || hop.pitchStates.length !== 88) {
          throw new Error(`ONLINE_AMT_HOP_PITCH_STATE_COUNT_INVALID:${scenario.scenarioId}`);
        }
      }
    }
    return onlineAmtModule.runOnlineAmtStreamingCandidateFromHopArtifact({
      scenario,
      artifact: hopArtifact,
      candidateId: this.config.candidateId,
      command: `docker run ${this.config.dockerImage}`,
      runtime: 'real-online-amt-modern-docker',
      timingCorrectionMs: this.config.streaming.timingCorrectionMs,
    });
  }

  _runSyntheticInference(scenario, options) {
    const completion = scenario.completion?.performanceTimeMs ?? scenario.audio?.clipEndMs;
    if (!Number.isFinite(completion)) throw new Error(`ONLINE_AMT_COMPLETION_REQUIRED:${scenario.scenarioId}`);
    const hopMs = 32;
    const hopCount = Math.ceil(completion / hopMs);
    const hops = [];
    const noteNames = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const generate88 = (activePitch) => Array.from({ length: 88 }, (_, index) => {
      const midi = 21 + index;
      const pitch = `${noteNames[midi % 12]}${Math.floor(midi / 12) - 1}`;
      const active = activePitch !== null && pitch === activePitch;
      return { pitch, chosenState: active ? 3 : 0, probabilities: active ? [0.01, 0.01, 0.02, 0.90, 0.06] : [0.95, 0.01, 0.02, 0.01, 0.01] };
    });
    for (let h = 0; h < hopCount; h += 1) {
      const activePitch = (options.syntheticPitch && h === Math.floor(hopCount / 2)) ? options.syntheticPitch : null;
      hops.push({
        hopIndex: h,
        localDecisionSample: (h + 1) * 512,
        processingLatencyMs: options.simulatedLatencyMs ?? 5,
        pitchStates: generate88(activePitch),
      });
    }
    const artifact = {
      schemaVersion: 1,
      artifact: 'online_amt_real_hop_output',
      segments: [{
        segmentId: `${scenario.scenarioId}:segment-0`,
        performanceStartMs: 0,
        performanceOwnedSamples: Math.floor(completion / 1000 * 16000),
        contextTailSamples: onlineAmtModule.onlineAmtSegmentTailRequirement(Math.floor(completion / 1000 * 16000), this.config.streaming.timingCorrectionMs).requiredContextTailSamples,
        hops,
      }],
    };
    return onlineAmtModule.runOnlineAmtStreamingCandidateFromHopArtifact({
      scenario,
      artifact,
      candidateId: this.config.candidateId,
      command: 'synthetic online-amt',
      runtime: 'synthetic-online-amt-stateful',
      timingCorrectionMs: this.config.streaming.timingCorrectionMs,
    });
  }
}

export function extractResampleLinear(input) {
  if (input.outputSamples === 0) return new Float32Array(0);
  const sourceStart = input.sourceStartMs / 1000 * input.sourceSampleRateHz;
  const sourceEnd = input.sourceEndMs / 1000 * input.sourceSampleRateHz;
  if (sourceStart < -1e-6 || sourceEnd > input.sourcePcm.length + 1e-6 || sourceEnd < sourceStart) {
    throw new Error(`RESAMPLE_WINDOW_OUTSIDE_SOURCE:${input.sourceStartMs}..${input.sourceEndMs}`);
  }
  const output = new Float32Array(input.outputSamples);
  const sourceSpan = sourceEnd - sourceStart;
  for (let i = 0; i < input.outputSamples; i += 1) {
    const pos = sourceStart + i * sourceSpan / input.outputSamples;
    const left = Math.floor(pos);
    const right = Math.min(input.sourcePcm.length - 1, left + 1);
    const frac = pos - left;
    output[i] = (input.sourcePcm[left] ?? 0) * (1 - frac) + (input.sourcePcm[right] ?? 0) * frac;
  }
  return output;
}

export function createCandidateAdapter(candidateId) {
  switch (candidateId) {
    case 'bytedance-original-calibrated-v1':
      return new ByteDanceOriginalAdapter();
    case 'online-amt-calibrated-v1':
      return new OnlineAmtStreamingAdapter();
    case 'bytedance-robust-augmented-calibrated-v1':
      return new RobustByteDanceAdapter();
    default:
      throw new Error(`UNKNOWN_CANDIDATE_ID:${candidateId}`);
  }
}

function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function sha256Json(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function sha256Float32Array(values) {
  const bytes = new Uint8Array(values.length * 4);
  const view = new DataView(bytes.buffer);
  values.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return sha256Buffer(bytes);
}
