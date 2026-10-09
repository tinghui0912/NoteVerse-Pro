import { createHash } from 'node:crypto';

import {
  BYTEDANCE_INFERENCE_CONTRACT,
  BYTEDANCE_INPUT_DESCRIPTOR,
  type ByteDanceRawOutputs,
} from '../acoustic-inference/bytedance-contract';
import { decodeByteDanceRawOutputs } from '../acoustic-inference/bytedance-decoder';
import {
  sourceAudioTimeToPerformanceMs,
  type BenchmarkScenario,
  type CandidateDefinition,
  type CandidateObservation,
  type CandidatePublication,
  type CandidateScenarioRun,
} from './continuous-analyzer-bakeoff';

export const BYTEDANCE_CHUNKED_BASELINE_CONFIG = {
  adapterVersion: 'phase9e-a-score-aware-chunked-v1',
  candidateId: 'bytedance-score-aware-chunked-dev-v1',
  strategyKind: 'CHUNKED' as const,
  label: 'SCORE_AWARE_CHUNKED_RESEARCH_BASELINE',
  modelRuntime: 'ByteDance high-resolution piano transcription ONNX research adapter',
  modelSha256: '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5',
  modelBytes: 98_691_493,
  modelInputMs: Math.round(BYTEDANCE_INPUT_DESCRIPTOR.shape[1] / BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz * 1000),
  futureContextMs: BYTEDANCE_INFERENCE_CONTRACT.futureMs,
  maxCommitWidthMs: 600,
  inputSampleRateHz: BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz,
  onsetThreshold: BYTEDANCE_INFERENCE_CONTRACT.onsetThreshold,
  frameThreshold: BYTEDANCE_INFERENCE_CONTRACT.frameThreshold,
  sourceContextPolicy: 'FAIL_CLOSED_NO_ZERO_PADDING',
  downmixPolicy: 'average_channels_to_mono_float32',
  resampler: 'deterministic_linear_interpolation_v1',
} as const;

export const BYTEDANCE_PHASE9E_A3_EXECUTION_PROFILE = {
  profileId: 'bytedance-onnx-ortweb-wasm-disabledopt-concurrency1-v1',
  ortWebVersion: '1.20.1',
  executionProvider: 'wasm',
  graphOptimizationLevel: 'disabled',
  candidateInferenceConcurrency: 1,
} as const;

export type ByteDanceChunkPlan = {
  chunkId: string;
  scenarioId: string;
  commitStartPerformanceMs: number;
  commitEndPerformanceMs: number;
  inputStartPerformanceMs: number;
  inputEndPerformanceMs: number;
  expectedGroupIds: readonly string[];
};

export type ByteDanceDecodedModelEvent = {
  eventId: string;
  pitch: string;
  performanceTimeMs: number;
  confidence: number;
  onsetScore: number;
  frameScore: number;
};

export type ByteDanceBlockedRunArtifact = {
  schemaVersion: 1;
  artifact: 'phase9e_a_bytedance_blocked_not_run';
  candidateId: typeof BYTEDANCE_CHUNKED_BASELINE_CONFIG.candidateId;
  status: 'BLOCKED_NOT_RUN';
  missingFiles: readonly {
    path: string;
    expectedSha256?: string;
    expectedBytes?: number;
    kind: 'MODEL' | 'AUDIO' | 'MIDI' | 'MANIFEST' | 'RUNTIME';
    reason?: 'MISSING' | 'MISMATCH' | 'UNAVAILABLE_IDENTITY';
  }[];
  discoveredScenarioCount: number;
  command: string;
  reason: string;
};

export type ByteDanceModelExecutor = (input: {
  scenario: BenchmarkScenario;
  plan: ByteDanceChunkPlan;
  inputPcm16k: Float32Array;
}) => Promise<{
  raw: ByteDanceRawOutputs;
  inferenceLatencyMs: number;
  candidateProcessingLatencyMs?: number;
}>;

export type ByteDanceBrowserRawOutputChunk = {
  chunkId: string;
  rawOutputs: {
    reg_onset_output: { dims: readonly number[]; data: readonly number[] };
    frame_output: { dims: readonly number[]; data: readonly number[] };
  };
};

export function bytedanceCandidateDefinition(input: {
  gitHead: string;
  configurationSha256?: string;
  trainingDataOverlapStatus?: 'KNOWN_OVERLAP' | 'KNOWN_DISJOINT' | 'UNKNOWN';
}): CandidateDefinition {
  const configurationSha256 = input.configurationSha256 ?? bytedanceConfigurationSha256();
  if (!/^[a-f0-9]{64}$/i.test(configurationSha256)) {
    throw new Error('ByteDance candidate configurationSha256 must be a real 64-character SHA256 hex digest.');
  }
  return {
    candidateId: BYTEDANCE_CHUNKED_BASELINE_CONFIG.candidateId,
    strategyKind: 'CHUNKED',
    identity: {
      modelRuntime: BYTEDANCE_CHUNKED_BASELINE_CONFIG.modelRuntime,
      modelCheckpointSha256: BYTEDANCE_CHUNKED_BASELINE_CONFIG.modelSha256,
      adapterVersion: BYTEDANCE_CHUNKED_BASELINE_CONFIG.adapterVersion,
      sourceGitHead: input.gitHead,
      configurationSha256,
      trainingDataOverlapStatus: input.trainingDataOverlapStatus ?? 'UNKNOWN',
    },
  };
}

export function bytedanceConfigurationSha256(): string {
  return sha256Hex(canonicalJson(BYTEDANCE_CHUNKED_BASELINE_CONFIG));
}

export function bytedanceExecutionProfileSha256(): string {
  return sha256Hex(canonicalJson(BYTEDANCE_PHASE9E_A3_EXECUTION_PROFILE));
}

export function planByteDanceScoreAwareChunks(
  scenario: BenchmarkScenario,
  config: typeof BYTEDANCE_CHUNKED_BASELINE_CONFIG = BYTEDANCE_CHUNKED_BASELINE_CONFIG
): readonly ByteDanceChunkPlan[] {
  const completion = completionTimeMs(scenario);
  const groups = groupExpectedStrikesBySimultaneousAttack(scenario)
    .filter((group) => group.expectedPerformanceTimeMs <= completion);
  const plans: ByteDanceChunkPlan[] = [];
  let start = 0;
  while (start < completion || (completion === 0 && plans.length === 0)) {
    const end = Math.min(completion, start + config.maxCommitWidthMs);
    const expectedGroupIds = groups
      .filter((group) => ownsPerformanceTime({ start, end, isFirst: plans.length === 0 }, group.expectedPerformanceTimeMs))
      .map((group) => group.groupId);
    const inputEnd = end + config.futureContextMs;
    plans.push({
      chunkId: `${scenario.scenarioId}:chunk-${plans.length}`,
      scenarioId: scenario.scenarioId,
      commitStartPerformanceMs: start,
      commitEndPerformanceMs: end,
      inputStartPerformanceMs: inputEnd - config.modelInputMs,
      inputEndPerformanceMs: inputEnd,
      expectedGroupIds,
    });
    if (end === completion) break;
    start = end;
  }
  validateChunkPlan(scenario, plans, config);
  return plans;
}

export function validateChunkPlan(
  scenario: BenchmarkScenario,
  plans: readonly ByteDanceChunkPlan[],
  config: typeof BYTEDANCE_CHUNKED_BASELINE_CONFIG = BYTEDANCE_CHUNKED_BASELINE_CONFIG
): void {
  const completion = completionTimeMs(scenario);
  let previousEnd = 0;
  const groupToPlan = new Map<string, string>();
  plans.forEach((plan, index) => {
    if (plan.scenarioId !== scenario.scenarioId) {
      throw new Error('ByteDance chunk plan scenarioId does not match scenario.');
    }
    const width = plan.commitEndPerformanceMs - plan.commitStartPerformanceMs;
    const inputWidth = plan.inputEndPerformanceMs - plan.inputStartPerformanceMs;
    if (
      !Number.isFinite(plan.commitStartPerformanceMs)
      || !Number.isFinite(plan.commitEndPerformanceMs)
      || width < 0
      || width > config.maxCommitWidthMs
      || plan.commitStartPerformanceMs !== previousEnd
    ) {
      throw new Error('ByteDance chunk commit ownership must be continuous and no wider than maxCommitWidthMs.');
    }
    if (inputWidth !== config.modelInputMs) {
      throw new Error('ByteDance chunk input duration must equal the fixed model input duration.');
    }
    for (const groupId of plan.expectedGroupIds) {
      if (groupToPlan.has(groupId)) {
        throw new Error(`ExpectedStrike group ${groupId} is split across ByteDance chunks.`);
      }
      groupToPlan.set(groupId, plan.chunkId);
    }
    previousEnd = plan.commitEndPerformanceMs;
    if (index === plans.length - 1 && plan.commitEndPerformanceMs !== completion) {
      throw new Error('ByteDance chunk plan must cover through scenario completion.');
    }
  });
  const plannedGroups = new Set(groupToPlan.keys());
  for (const group of groupExpectedStrikesBySimultaneousAttack(scenario)) {
    if (group.expectedPerformanceTimeMs > completion) continue;
    if (!plannedGroups.has(group.groupId)) {
      throw new Error(`ExpectedStrike group ${group.groupId} is missing from ByteDance chunk plan.`);
    }
  }
}

export function validateByteDanceSourceContext(
  scenario: BenchmarkScenario,
  plans: readonly ByteDanceChunkPlan[]
): void {
  for (const plan of plans) {
    const sourceInputStart = scenario.audio.performanceOriginSourceMs + plan.inputStartPerformanceMs;
    const sourceInputEnd = scenario.audio.performanceOriginSourceMs + plan.inputEndPerformanceMs;
    if (sourceInputStart < scenario.audio.clipStartMs) {
      throw new Error(`ByteDance chunk ${plan.chunkId} requires unavailable pre-roll context.`);
    }
    if (sourceInputEnd > scenario.audio.clipEndMs) {
      throw new Error(`ByteDance chunk ${plan.chunkId} requires unavailable post-roll context.`);
    }
  }
}

export function observationsForByteDanceChunk(
  scenario: BenchmarkScenario,
  plan: ByteDanceChunkPlan,
  decodedEvents: readonly ByteDanceDecodedModelEvent[]
): readonly CandidateObservation[] {
  return decodedEvents
    .filter((event) => ownsEventTime(plan, scenario, event.performanceTimeMs))
    .map((event, ordinal) => ({
      observationId: stableObservationId({
        scenarioId: scenario.scenarioId,
        chunkId: plan.chunkId,
        eventId: event.eventId,
        pitch: event.pitch,
        performanceTimeMs: event.performanceTimeMs,
        ordinal,
      }),
      pitch: event.pitch,
      performanceTimeMs: event.performanceTimeMs,
      confidence: event.confidence,
    }));
}

export function decodeByteDanceChunkRawOutputs(input: {
  scenario: BenchmarkScenario;
  plan: ByteDanceChunkPlan;
  raw: ByteDanceRawOutputs;
  inferenceCompletedAtMs?: number;
  onsetThreshold?: number;
  frameThreshold?: number;
}): readonly ByteDanceDecodedModelEvent[] {
  validateByteDanceRawOutputs(input.raw);
  const captureStartSampleIndex = Math.round(input.plan.inputStartPerformanceMs / 1000 * BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz);
  const request = {
    requestId: input.plan.chunkId,
    pcm: new Float32Array(BYTEDANCE_INPUT_DESCRIPTOR.shape[1]),
    sampleRateHz: BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz,
    channelCount: 1 as const,
    captureStartSampleIndex,
    captureStartTime: {
      domainId: `${input.scenario.scenarioId}:${input.plan.chunkId}`,
      ms: input.plan.inputStartPerformanceMs,
      sampleIndex: captureStartSampleIndex,
    },
  };
  return decodeByteDanceRawOutputs(input.raw, request, {
    inferenceCompletedAtMs: input.inferenceCompletedAtMs,
    onsetThreshold: input.onsetThreshold ?? BYTEDANCE_CHUNKED_BASELINE_CONFIG.onsetThreshold,
    frameThreshold: input.frameThreshold ?? BYTEDANCE_CHUNKED_BASELINE_CONFIG.frameThreshold,
  }).map((event, index) => ({
    eventId: `${input.plan.chunkId}:frame-event-${index}`,
    pitch: event.pitch,
    performanceTimeMs: event.onsetTime.ms,
    confidence: event.confidence,
    onsetScore: event.onsetScore,
    frameScore: event.frameScore,
  }));
}

export function publicationForByteDanceChunk(input: {
  scenario: BenchmarkScenario;
  plan: ByteDanceChunkPlan;
  observations: readonly CandidateObservation[];
  inferenceLatencyMs?: number;
  candidateProcessingLatencyMs?: number;
  publicationAvailableAtMs?: number;
  inferenceStartAtMs?: number;
  queueDelayMs?: number;
}): CandidatePublication {
  const latency = input.inferenceLatencyMs ?? 0;
  const processingLatency = input.candidateProcessingLatencyMs;
  const availabilityTimeMs = input.publicationAvailableAtMs;
  return {
    publicationId: `${input.plan.chunkId}:publication`,
    observations: input.observations,
    analyzedThroughPerformanceMs: input.plan.commitEndPerformanceMs,
    ...(availabilityTimeMs === undefined ? {} : { availabilityTimeMs }),
    diagnostics: {
      strategyShape: 'CHUNKED',
      chunkIndex: Number(input.plan.chunkId.split('chunk-').at(-1) ?? 0),
      inputStartMs: input.plan.inputStartPerformanceMs,
      inputEndMs: input.plan.inputEndPerformanceMs,
      inferenceLatencyMs: latency,
      ...(availabilityTimeMs === undefined ? {} : { publicationDelayMs: availabilityTimeMs - input.plan.commitEndPerformanceMs }),
      requiredFutureContextMs: input.plan.inputEndPerformanceMs - input.plan.commitEndPerformanceMs,
      modelInferenceLatencyMs: latency,
      ...(processingLatency === undefined ? {} : { adapterOverheadMs: processingLatency - latency }),
      ...(processingLatency === undefined ? {} : { candidateProcessingLatencyMs: processingLatency }),
      ...(input.inferenceStartAtMs === undefined ? {} : { inputReadyAtMs: input.plan.inputEndPerformanceMs }),
      ...(input.inferenceStartAtMs === undefined ? {} : { inferenceStartAtMs: input.inferenceStartAtMs }),
      ...(input.queueDelayMs === undefined ? {} : { queueDelayMs: input.queueDelayMs }),
      ...(availabilityTimeMs === undefined ? {} : { totalPublicationDelayMs: availabilityTimeMs - input.plan.commitEndPerformanceMs }),
    },
  };
}

export function scheduleByteDanceSingleWorkerPublications(input: {
  plans: readonly ByteDanceChunkPlan[];
  processingLatencyMsByChunkId: ReadonlyMap<string, number>;
}): ReadonlyMap<string, {
  inputReadyAtMs: number;
  inferenceStartAtMs: number;
  inferenceFinishAtMs: number;
  queueDelayMs: number;
}> {
  let previousFinish = 0;
  const schedule = new Map<string, {
    inputReadyAtMs: number;
    inferenceStartAtMs: number;
    inferenceFinishAtMs: number;
    queueDelayMs: number;
  }>();
  for (const plan of input.plans) {
    const latency = input.processingLatencyMsByChunkId.get(plan.chunkId);
    if (latency === undefined || !Number.isFinite(latency) || latency < 0) {
      throw new Error(`Missing finite candidate processing latency for ${plan.chunkId}.`);
    }
    const inputReadyAtMs = plan.inputEndPerformanceMs;
    const inferenceStartAtMs = Math.max(inputReadyAtMs, previousFinish);
    const inferenceFinishAtMs = inferenceStartAtMs + latency;
    schedule.set(plan.chunkId, {
      inputReadyAtMs,
      inferenceStartAtMs,
      inferenceFinishAtMs,
      queueDelayMs: inferenceStartAtMs - inputReadyAtMs,
    });
    previousFinish = inferenceFinishAtMs;
  }
  return schedule;
}

export async function executeByteDanceScenarioWithExecutor(input: {
  scenario: BenchmarkScenario;
  sourcePcm: Float32Array;
  sourceSampleRateHz: number;
  executor: ByteDanceModelExecutor;
  candidateId: string;
  command: string;
  runtime: string;
}): Promise<CandidateScenarioRun> {
  validateDecodedWavAgainstScenario({
    scenario: input.scenario,
    sampleRateHz: input.sourceSampleRateHz,
    durationMs: input.sourcePcm.length / input.sourceSampleRateHz * 1000,
  });
  const plans = planByteDanceScoreAwareChunks(input.scenario);
  validateByteDanceSourceContext(input.scenario, plans);
  const decodedByPlan = new Map<string, readonly ByteDanceDecodedModelEvent[]>();
  const inferenceLatencyByPlan = new Map<string, number>();
  const processingLatencyByPlan = new Map<string, number>();
  for (const plan of plans) {
    const sourceInputStartMs = input.scenario.audio.performanceOriginSourceMs + plan.inputStartPerformanceMs;
    const sourceInputEndMs = input.scenario.audio.performanceOriginSourceMs + plan.inputEndPerformanceMs;
    const inputPcm = extractAndResampleLinear16k({
      sourcePcm: input.sourcePcm,
      sourceSampleRateHz: input.sourceSampleRateHz,
      sourceStartMs: sourceInputStartMs,
      sourceEndMs: sourceInputEndMs,
    });
    const result = await input.executor({ scenario: input.scenario, plan, inputPcm16k: inputPcm });
    const decoded = decodeByteDanceChunkRawOutputs({ scenario: input.scenario, plan, raw: result.raw });
    decodedByPlan.set(plan.chunkId, decoded);
    inferenceLatencyByPlan.set(plan.chunkId, result.inferenceLatencyMs);
    if (result.candidateProcessingLatencyMs !== undefined) {
      processingLatencyByPlan.set(plan.chunkId, result.candidateProcessingLatencyMs);
    }
  }
  const schedule = processingLatencyByPlan.size === plans.length
    ? scheduleByteDanceSingleWorkerPublications({ plans, processingLatencyMsByChunkId: processingLatencyByPlan })
    : undefined;
  const publications: CandidatePublication[] = plans.map((plan) => {
    const timing = schedule?.get(plan.chunkId);
    return publicationForByteDanceChunk({
      scenario: input.scenario,
      plan,
      observations: observationsForByteDanceChunk(input.scenario, plan, decodedByPlan.get(plan.chunkId) ?? []),
      inferenceLatencyMs: inferenceLatencyByPlan.get(plan.chunkId),
      candidateProcessingLatencyMs: processingLatencyByPlan.get(plan.chunkId),
      publicationAvailableAtMs: timing?.inferenceFinishAtMs,
      inferenceStartAtMs: timing?.inferenceStartAtMs,
      queueDelayMs: timing?.queueDelayMs,
    });
  });
  return candidateRunForByteDanceChunks({
    candidateId: input.candidateId,
    scenarioId: input.scenario.scenarioId,
    publications,
    command: input.command,
    runtime: input.runtime,
  });
}

export function validateByteDanceRawOutputs(raw: ByteDanceRawOutputs): void {
  validateRawTensor('reg_onset_output', raw.reg_onset_output, raw.reg_onset_shape);
  validateRawTensor('frame_output', raw.frame_output, raw.frame_shape);
}

export function byteDanceRawOutputsFromBrowserChunkArtifact(
  chunk: ByteDanceBrowserRawOutputChunk
): ByteDanceRawOutputs {
  const raw: ByteDanceRawOutputs = {
    reg_onset_output: float32FromArtifactData('reg_onset_output', chunk.rawOutputs.reg_onset_output.data),
    reg_onset_shape: chunk.rawOutputs.reg_onset_output.dims,
    frame_output: float32FromArtifactData('frame_output', chunk.rawOutputs.frame_output.data),
    frame_shape: chunk.rawOutputs.frame_output.dims,
  };
  validateByteDanceRawOutputs(raw);
  return raw;
}

export function candidateRunForByteDanceChunks(input: {
  candidateId: string;
  scenarioId: string;
  publications: readonly CandidatePublication[];
  command: string;
  runtime: string;
}): CandidateScenarioRun {
  return {
    candidateId: input.candidateId,
    scenarioId: input.scenarioId,
    publications: input.publications,
    runProvenance: {
      command: input.command,
      runtime: input.runtime,
    },
  };
}

export function sourceEventTimeToPerformanceTime(
  scenario: BenchmarkScenario,
  sourceAudioTimeMs: number
): number {
  return sourceAudioTimeToPerformanceMs(scenario, sourceAudioTimeMs);
}

export function extractAndResampleLinear16k(input: {
  sourcePcm: Float32Array;
  sourceSampleRateHz: number;
  sourceStartMs: number;
  sourceEndMs: number;
}): Float32Array {
  if (!Number.isFinite(input.sourceSampleRateHz) || input.sourceSampleRateHz <= 0) {
    throw new Error('Source sample rate must be positive and finite.');
  }
  const outputLength = BYTEDANCE_INPUT_DESCRIPTOR.shape[1];
  const sourceStart = input.sourceStartMs / 1000 * input.sourceSampleRateHz;
  const sourceEnd = input.sourceEndMs / 1000 * input.sourceSampleRateHz;
  if (sourceStart < 0 || sourceEnd > input.sourcePcm.length || sourceEnd <= sourceStart) {
    throw new Error('Requested ByteDance input window is outside source PCM.');
  }
  const output = new Float32Array(outputLength);
  const sourceSpan = sourceEnd - sourceStart;
  for (let index = 0; index < outputLength; index += 1) {
    const position = sourceStart + index * sourceSpan / outputLength;
    const left = Math.floor(position);
    const right = Math.min(input.sourcePcm.length - 1, left + 1);
    const fraction = position - left;
    output[index] = (input.sourcePcm[left] ?? 0) * (1 - fraction) + (input.sourcePcm[right] ?? 0) * fraction;
  }
  return output;
}

export function decodeResearchWavToMonoFloat32(bytes: ArrayBuffer | Uint8Array): {
  pcm: Float32Array;
  sampleRateHz: number;
  channelCount: number;
  durationMs: number;
} {
  const data = bytes instanceof Uint8Array
    ? new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    : new DataView(bytes);
  if (ascii(data, 0, 4) !== 'RIFF' || ascii(data, 8, 4) !== 'WAVE') {
    throw new Error('Research WAV loader supports RIFF/WAVE only.');
  }
  let offset = 12;
  let audioFormat: number | null = null;
  let channelCount: number | null = null;
  let sampleRateHz: number | null = null;
  let bitsPerSample: number | null = null;
  let dataOffset: number | null = null;
  let dataBytes: number | null = null;
  while (offset + 8 <= data.byteLength) {
    const chunkId = ascii(data, offset, 4);
    const chunkSize = data.getUint32(offset + 4, true);
    const chunkDataOffset = offset + 8;
    if (chunkId === 'fmt ') {
      audioFormat = data.getUint16(chunkDataOffset, true);
      channelCount = data.getUint16(chunkDataOffset + 2, true);
      sampleRateHz = data.getUint32(chunkDataOffset + 4, true);
      bitsPerSample = data.getUint16(chunkDataOffset + 14, true);
    } else if (chunkId === 'data') {
      dataOffset = chunkDataOffset;
      dataBytes = chunkSize;
    }
    offset = chunkDataOffset + chunkSize + (chunkSize % 2);
  }
  if (!audioFormat || !channelCount || !sampleRateHz || !bitsPerSample || dataOffset === null || dataBytes === null) {
    throw new Error('Research WAV loader requires fmt and data chunks.');
  }
  if (audioFormat !== 1 || bitsPerSample !== 16) {
    throw new Error('Research WAV loader currently supports PCM16 WAV only.');
  }
  const frameCount = Math.floor(dataBytes / (channelCount * 2));
  const pcm = new Float32Array(frameCount);
  for (let frame = 0; frame < frameCount; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sampleOffset = dataOffset + (frame * channelCount + channel) * 2;
      sum += data.getInt16(sampleOffset, true) / 32768;
    }
    pcm[frame] = sum / channelCount;
  }
  return {
    pcm,
    sampleRateHz,
    channelCount,
    durationMs: frameCount / sampleRateHz * 1000,
  };
}

export function validateDecodedWavAgainstScenario(input: {
  scenario: BenchmarkScenario;
  sampleRateHz: number;
  durationMs: number;
}): void {
  if (input.sampleRateHz !== input.scenario.audio.nativeSampleRateHz) {
    throw new Error('Decoded source sample rate does not match BenchmarkScenario audio metadata.');
  }
  if (
    input.scenario.audio.sourceDurationMs !== undefined
    && Math.abs(input.durationMs - input.scenario.audio.sourceDurationMs) > 1
  ) {
    throw new Error('Decoded source duration does not match BenchmarkScenario audio metadata.');
  }
}

export function assertAssetIdentity(input: {
  kind: 'MODEL' | 'AUDIO' | 'MIDI' | 'MANIFEST' | 'RUNTIME';
  path: string;
  expectedSha256?: string;
  actualSha256?: string;
  expectedBytes?: number;
  actualBytes?: number;
}): void {
  if (input.expectedSha256 && !input.actualSha256) {
    throw new Error(`${input.kind} identity missing for ${input.path}.`);
  }
  if (input.expectedBytes !== undefined && input.actualBytes === undefined) {
    throw new Error(`${input.kind} byte size missing for ${input.path}.`);
  }
  if (input.expectedSha256 && input.actualSha256 && input.expectedSha256 !== input.actualSha256) {
    throw new Error(`${input.kind} SHA256 mismatch for ${input.path}.`);
  }
  if (input.expectedBytes !== undefined && input.actualBytes !== undefined && input.expectedBytes !== input.actualBytes) {
    throw new Error(`${input.kind} byte size mismatch for ${input.path}.`);
  }
}

function validateRawTensor(name: string, data: Float32Array, shape: readonly number[]): void {
  if (shape.length !== 3 || shape[0] !== 1 || shape[1] !== 183 || shape[2] !== 88) {
    throw new Error(`ByteDance ${name} must have exact shape [1,183,88].`);
  }
  if (data.length !== 1 * 183 * 88) {
    throw new Error(`ByteDance ${name} length does not match [1,183,88].`);
  }
  for (const value of data) {
    if (!Number.isFinite(value)) {
      throw new Error(`ByteDance ${name} contains non-finite values.`);
    }
  }
}

function float32FromArtifactData(name: string, values: readonly number[]): Float32Array {
  const output = new Float32Array(values.length);
  values.forEach((value, index) => {
    if (!Number.isFinite(value)) {
      throw new Error(`ByteDance ${name} raw artifact contains non-finite values.`);
    }
    output[index] = value;
  });
  return output;
}

export function blockedByteDanceRunArtifact(input: {
  missingFiles: ByteDanceBlockedRunArtifact['missingFiles'];
  discoveredScenarioCount: number;
  command: string;
  reason?: string;
}): ByteDanceBlockedRunArtifact {
  return {
    schemaVersion: 1,
    artifact: 'phase9e_a_bytedance_blocked_not_run',
    candidateId: BYTEDANCE_CHUNKED_BASELINE_CONFIG.candidateId,
    status: 'BLOCKED_NOT_RUN',
    missingFiles: input.missingFiles,
    discoveredScenarioCount: input.discoveredScenarioCount,
    command: input.command,
    reason: input.reason ?? 'Required external assets were unavailable; no measured ByteDance DEVELOPMENT result was produced.',
  };
}

function groupExpectedStrikesBySimultaneousAttack(scenario: BenchmarkScenario): {
  groupId: string;
  expectedPerformanceTimeMs: number;
}[] {
  const byGroup = new Map<string, number>();
  for (const strike of scenario.expectedStrikes) {
    const previous = byGroup.get(strike.groupId);
    if (previous !== undefined && previous !== strike.expectedPerformanceTimeMs) {
      throw new Error(`ExpectedStrike group ${strike.groupId} has non-simultaneous members.`);
    }
    byGroup.set(strike.groupId, strike.expectedPerformanceTimeMs);
  }
  return [...byGroup.entries()]
    .map(([groupId, expectedPerformanceTimeMs]) => ({ groupId, expectedPerformanceTimeMs }))
    .sort((left, right) => left.expectedPerformanceTimeMs - right.expectedPerformanceTimeMs
      || left.groupId.localeCompare(right.groupId));
}

function ownsEventTime(plan: ByteDanceChunkPlan, scenario: BenchmarkScenario, performanceTimeMs: number): boolean {
  const plans = planByteDanceScoreAwareChunks(scenario);
  const index = plans.findIndex((candidate) => candidate.chunkId === plan.chunkId);
  return ownsPerformanceTime({
    start: plan.commitStartPerformanceMs,
    end: plan.commitEndPerformanceMs,
    isFirst: index <= 0,
  }, performanceTimeMs);
}

function ownsPerformanceTime(input: { start: number; end: number; isFirst: boolean }, performanceTimeMs: number): boolean {
  return (input.isFirst ? performanceTimeMs >= input.start : performanceTimeMs > input.start)
    && performanceTimeMs <= input.end;
}

function completionTimeMs(scenario: BenchmarkScenario): number {
  return scenario.completion?.performanceTimeMs
    ?? Math.max(...scenario.expectedStrikes.map((strike) => strike.expectedPerformanceTimeMs));
}

function stableObservationId(input: {
  scenarioId: string;
  chunkId: string;
  eventId: string;
  pitch: string;
  performanceTimeMs: number;
  ordinal: number;
}): string {
  return [
    'bd',
    sanitizeIdentity(input.scenarioId),
    sanitizeIdentity(input.chunkId),
    sanitizeIdentity(input.pitch),
    input.performanceTimeMs.toFixed(3),
    sanitizeIdentity(input.eventId),
    String(input.ordinal),
  ].join(':');
}

function sanitizeIdentity(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_');
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}

function ascii(view: DataView, offset: number, length: number): string {
  let text = '';
  for (let index = 0; index < length; index += 1) {
    text += String.fromCharCode(view.getUint8(offset + index));
  }
  return text;
}
