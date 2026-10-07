import {
  BYTEDANCE_INFERENCE_CONTRACT,
  BYTEDANCE_INPUT_DESCRIPTOR,
} from '../acoustic-inference/bytedance-contract';
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
  modelRuntime: 'ByteDance high-resolution piano transcription ONNX research adapter',
  modelSha256: '6ba3bc4e73607f9cd021e69858fd3ff969a3941c7a93876d5be5cedb53038cf5',
  modelBytes: 98_691_493,
  modelInputMs: Math.round(BYTEDANCE_INPUT_DESCRIPTOR.shape[1] / BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz * 1000),
  futureContextMs: BYTEDANCE_INFERENCE_CONTRACT.futureMs,
  maxCommitWidthMs: 600,
  inputSampleRateHz: BYTEDANCE_INFERENCE_CONTRACT.sampleRateHz,
  onsetThreshold: BYTEDANCE_INFERENCE_CONTRACT.onsetThreshold,
  frameThreshold: BYTEDANCE_INFERENCE_CONTRACT.frameThreshold,
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
  }[];
  discoveredScenarioCount: number;
  command: string;
  reason: string;
};

export function bytedanceCandidateDefinition(input: {
  gitHead: string;
  configurationSha256?: string;
  trainingDataOverlapStatus?: 'KNOWN_OVERLAP' | 'KNOWN_DISJOINT' | 'UNKNOWN';
}): CandidateDefinition {
  return {
    candidateId: BYTEDANCE_CHUNKED_BASELINE_CONFIG.candidateId,
    strategyKind: 'CHUNKED',
    identity: {
      modelRuntime: BYTEDANCE_CHUNKED_BASELINE_CONFIG.modelRuntime,
      modelCheckpointSha256: BYTEDANCE_CHUNKED_BASELINE_CONFIG.modelSha256,
      adapterVersion: BYTEDANCE_CHUNKED_BASELINE_CONFIG.adapterVersion,
      sourceGitHead: input.gitHead,
      configurationSha256: input.configurationSha256 ?? stableConfigurationSha256(BYTEDANCE_CHUNKED_BASELINE_CONFIG),
      trainingDataOverlapStatus: input.trainingDataOverlapStatus ?? 'UNKNOWN',
    },
  };
}

export function planByteDanceScoreAwareChunks(
  scenario: BenchmarkScenario,
  config: typeof BYTEDANCE_CHUNKED_BASELINE_CONFIG = BYTEDANCE_CHUNKED_BASELINE_CONFIG
): readonly ByteDanceChunkPlan[] {
  const groups = groupExpectedStrikesBySimultaneousAttack(scenario);
  if (groups.length === 0) return [];
  const plans: ByteDanceChunkPlan[] = [];
  let groupIndex = 0;
  while (groupIndex < groups.length) {
    const first = groups[groupIndex];
    let endIndex = groupIndex;
    while (
      endIndex + 1 < groups.length
      && groups[endIndex + 1].expectedPerformanceTimeMs - first.expectedPerformanceTimeMs <= config.maxCommitWidthMs
    ) {
      endIndex += 1;
    }
    const chunkGroups = groups.slice(groupIndex, endIndex + 1);
    const last = groups[endIndex];
    const nextGroup = groups[endIndex + 1];
    const previousGroup = groups[groupIndex - 1];
    const commitStart = previousGroup
      ? midpoint(previousGroup.expectedPerformanceTimeMs, first.expectedPerformanceTimeMs)
      : 0;
    const commitEnd = nextGroup
      ? midpoint(last.expectedPerformanceTimeMs, nextGroup.expectedPerformanceTimeMs)
      : scenario.completion?.performanceTimeMs ?? first.expectedPerformanceTimeMs + config.maxCommitWidthMs;
    const historyContextMs = config.modelInputMs - config.futureContextMs - (commitEnd - commitStart);
    plans.push({
      chunkId: `${scenario.scenarioId}:chunk-${plans.length}`,
      scenarioId: scenario.scenarioId,
      commitStartPerformanceMs: commitStart,
      commitEndPerformanceMs: commitEnd,
      inputStartPerformanceMs: commitStart - Math.max(0, historyContextMs),
      inputEndPerformanceMs: commitEnd + config.futureContextMs,
      expectedGroupIds: chunkGroups.map((group) => group.groupId),
    });
    groupIndex = endIndex + 1;
  }
  validateChunkPlan(scenario, plans);
  return plans;
}

function midpoint(left: number, right: number): number {
  return (left + right) / 2;
}

export function validateChunkPlan(
  scenario: BenchmarkScenario,
  plans: readonly ByteDanceChunkPlan[]
): void {
  let previousEnd = 0;
  const groupToPlan = new Map<string, string>();
  for (const plan of plans) {
    if (plan.scenarioId !== scenario.scenarioId) {
      throw new Error('ByteDance chunk plan scenarioId does not match scenario.');
    }
    if (
      !Number.isFinite(plan.commitStartPerformanceMs)
      || !Number.isFinite(plan.commitEndPerformanceMs)
      || plan.commitEndPerformanceMs < plan.commitStartPerformanceMs
      || plan.commitStartPerformanceMs < previousEnd
    ) {
      throw new Error('ByteDance chunk commit ownership must be finite, ordered, and non-overlapping.');
    }
    if (plan.inputEndPerformanceMs < plan.commitEndPerformanceMs) {
      throw new Error('ByteDance chunk input must include its commit end.');
    }
    if (plan.inputStartPerformanceMs > plan.commitStartPerformanceMs) {
      throw new Error('ByteDance chunk input must include historical context at commit start.');
    }
    for (const groupId of plan.expectedGroupIds) {
      if (groupToPlan.has(groupId)) {
        throw new Error(`ExpectedStrike group ${groupId} is split across ByteDance chunks.`);
      }
      groupToPlan.set(groupId, plan.chunkId);
    }
    previousEnd = plan.commitEndPerformanceMs;
  }
  const plannedGroups = new Set(groupToPlan.keys());
  for (const groupId of new Set(scenario.expectedStrikes.map((strike) => strike.groupId))) {
    if (!plannedGroups.has(groupId)) {
      throw new Error(`ExpectedStrike group ${groupId} is missing from ByteDance chunk plan.`);
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
    .map((event) => ({
      observationId: stableObservationId({
        scenarioId: scenario.scenarioId,
        chunkId: plan.chunkId,
        eventId: event.eventId,
        pitch: event.pitch,
        performanceTimeMs: event.performanceTimeMs,
      }),
      pitch: event.pitch,
      performanceTimeMs: event.performanceTimeMs,
      confidence: event.confidence,
    }));
}

export function publicationForByteDanceChunk(input: {
  scenario: BenchmarkScenario;
  plan: ByteDanceChunkPlan;
  observations: readonly CandidateObservation[];
  inferenceLatencyMs?: number;
  publicationDelayMs?: number;
}): CandidatePublication {
  const futureContextAvailableAt = input.plan.commitEndPerformanceMs + BYTEDANCE_CHUNKED_BASELINE_CONFIG.futureContextMs;
  const latency = input.inferenceLatencyMs ?? 0;
  return {
    publicationId: `${input.plan.chunkId}:publication`,
    observations: input.observations,
    analyzedThroughPerformanceMs: input.plan.commitEndPerformanceMs,
    availabilityTimeMs: futureContextAvailableAt + latency,
    diagnostics: {
      strategyShape: 'CHUNKED',
      chunkIndex: Number(input.plan.chunkId.split('chunk-').at(-1) ?? 0),
      inputStartMs: input.plan.inputStartPerformanceMs,
      inputEndMs: input.plan.inputEndPerformanceMs,
      inferenceLatencyMs: latency,
      publicationDelayMs: input.publicationDelayMs ?? BYTEDANCE_CHUNKED_BASELINE_CONFIG.futureContextMs + latency,
    },
  };
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

export function assertAssetIdentity(input: {
  kind: 'MODEL' | 'AUDIO' | 'MIDI' | 'MANIFEST' | 'RUNTIME';
  path: string;
  expectedSha256?: string;
  actualSha256?: string;
  expectedBytes?: number;
  actualBytes?: number;
}): void {
  if (input.expectedSha256 && input.actualSha256 && input.expectedSha256 !== input.actualSha256) {
    throw new Error(`${input.kind} SHA256 mismatch for ${input.path}.`);
  }
  if (input.expectedBytes !== undefined && input.actualBytes !== undefined && input.expectedBytes !== input.actualBytes) {
    throw new Error(`${input.kind} byte size mismatch for ${input.path}.`);
  }
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
  const isFinalPlan = plan.commitEndPerformanceMs === scenario.completion?.performanceTimeMs;
  return performanceTimeMs >= plan.commitStartPerformanceMs
    && (performanceTimeMs < plan.commitEndPerformanceMs || (isFinalPlan && performanceTimeMs === plan.commitEndPerformanceMs));
}

function stableObservationId(input: {
  scenarioId: string;
  chunkId: string;
  eventId: string;
  pitch: string;
  performanceTimeMs: number;
}): string {
  return `bd:${stableConfigurationSha256(input).slice(0, 16)}`;
}

function stableConfigurationSha256(value: unknown): string {
  const text = stableJson(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).repeat(8).slice(0, 64);
}

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`;
}
