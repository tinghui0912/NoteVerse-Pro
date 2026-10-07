import { createHash } from 'node:crypto';

import type {
  BenchmarkScenario,
  CandidateDefinition,
  CandidateObservation,
  CandidatePublication,
  CandidateScenarioRun,
} from './continuous-analyzer-bakeoff';

export const ONLINE_AMT_STREAMING_BASELINE_CONFIG = {
  adapterVersion: 'phase9e-b-stateful-streaming-v1',
  candidateId: 'online-amt-stateful-modern-compat-dev-v1',
  strategyKind: 'STREAMING' as const,
  label: 'ONLINE_AMT_STATEFUL_STREAMING_RESEARCH_BASELINE',
  repo: 'https://github.com/jdasam/online_amt',
  repoCommit: 'ad12550909a1d86f699097d11885f427054a5ac2',
  checkpointRelativePath: 'model-180000.pt',
  checkpointSha256: '54ab4907b517dbfa2dbbee834db18d31d103ee25d690860595181162d235e3a0',
  checkpointBytes: 178_804_960,
  sampleRateHz: 16_000,
  hopSamples: 512,
  hopMs: 32,
  timingCorrectionMs: -158,
  publishedOnsetBoost: 2.0,
  pseudoIntensityShortcut: 'DISABLED',
  onsetStateIds: [3, 4],
  offsetStateIds: [1],
  confidenceDefinition: 'P_STATE_3_PLUS_P_STATE_4',
} as const;

export const ONLINE_AMT_MODERN_COMPAT_EXECUTION_PROFILE = {
  profileId: 'online-amt-modern-compat-python-cpu-stateful-v1',
  legacyRuntimeParity: 'UNPROVEN',
  candidateInferenceConcurrency: 1,
  authoritativeDevice: 'CPU',
  browserSupport: 'NOT_EVALUATED',
} as const;

export type OnlineAmtProbabilities = readonly [number, number, number, number, number];

export type OnlineAmtPitchState = {
  pitch: string;
  probabilities: OnlineAmtProbabilities;
  chosenState: number;
};

export type OnlineAmtHopOutput = {
  pitchStates: readonly OnlineAmtPitchState[];
  processingLatencyMs?: number;
};

export type OnlineAmtStreamingEngine = {
  reset(): void;
  processHop(pcm512: Float32Array): OnlineAmtHopOutput;
  snapshotState?(): unknown;
};

export type OnlineAmtSegment = {
  segmentId: string;
  performanceStartMs: number;
  pcm16k: Float32Array;
};

export function onlineAmtCandidateDefinition(input: {
  gitHead: string;
  configurationSha256?: string;
  trainingDataOverlapStatus?: 'KNOWN_OVERLAP' | 'KNOWN_DISJOINT' | 'UNKNOWN';
}): CandidateDefinition {
  const configurationSha256 = input.configurationSha256 ?? onlineAmtConfigurationSha256();
  if (!/^[a-f0-9]{64}$/i.test(configurationSha256)) {
    throw new Error('Online-AMT candidate configurationSha256 must be a 64-character SHA256 hex digest.');
  }
  return {
    candidateId: ONLINE_AMT_STREAMING_BASELINE_CONFIG.candidateId,
    strategyKind: 'STREAMING',
    identity: {
      modelRuntime: 'Online-AMT stateful Python modern-compat research adapter',
      modelCheckpointSha256: ONLINE_AMT_STREAMING_BASELINE_CONFIG.checkpointSha256,
      adapterVersion: ONLINE_AMT_STREAMING_BASELINE_CONFIG.adapterVersion,
      sourceGitHead: input.gitHead,
      configurationSha256,
      trainingDataOverlapStatus: input.trainingDataOverlapStatus ?? 'UNKNOWN',
    },
  };
}

export function onlineAmtConfigurationSha256(): string {
  return sha256Hex(canonicalJson(ONLINE_AMT_STREAMING_BASELINE_CONFIG));
}

export function onlineAmtExecutionProfileSha256(): string {
  return sha256Hex(canonicalJson(ONLINE_AMT_MODERN_COMPAT_EXECUTION_PROFILE));
}

export function runOnlineAmtStreamingCandidate(input: {
  scenario: BenchmarkScenario;
  segments: readonly OnlineAmtSegment[];
  engine: OnlineAmtStreamingEngine;
  candidateId: string;
  command: string;
  runtime: string;
}): CandidateScenarioRun {
  const publications: CandidatePublication[] = [];
  let previousCoverage = -Infinity;
  let previousProcessingFinish = 0;
  let publicationIndex = 0;
  for (const segment of input.segments) {
    input.engine.reset();
    const hopCount = Math.floor(segment.pcm16k.length / ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopSamples);
    for (let hopIndex = 0; hopIndex < hopCount; hopIndex += 1) {
      const hopStartSample = hopIndex * ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopSamples;
      const hop = segment.pcm16k.slice(hopStartSample, hopStartSample + ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopSamples);
      const decisionTimeMs = segment.performanceStartMs + (hopIndex + 1) * ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopMs;
      const coverage = eventTimeFromDecisionTimeMs(decisionTimeMs);
      const output = input.engine.processHop(hop);
      if (coverage < 0) {
        continue;
      }
      if (coverage < previousCoverage) {
        throw new Error('Online-AMT streaming coverage moved backward.');
      }
      const observations = observationsForOnlineAmtHop({
        scenarioId: input.scenario.scenarioId,
        segmentId: segment.segmentId,
        hopIndex,
        decisionTimeMs,
        pitchStates: output.pitchStates,
        previousCoverage,
      });
      const processingLatency = output.processingLatencyMs;
      const inputReadyAtMs = decisionTimeMs;
      const processingStartAtMs = processingLatency === undefined
        ? undefined
        : Math.max(inputReadyAtMs, previousProcessingFinish);
      const processingFinishAtMs = processingLatency === undefined || processingStartAtMs === undefined
        ? undefined
        : processingStartAtMs + processingLatency;
      if (processingFinishAtMs !== undefined) previousProcessingFinish = processingFinishAtMs;
      publications.push({
        publicationId: `${input.scenario.scenarioId}:online-amt:${publicationIndex}`,
        observations,
        analyzedThroughPerformanceMs: coverage,
        ...(processingFinishAtMs === undefined ? {} : { availabilityTimeMs: processingFinishAtMs }),
        diagnostics: {
          strategyShape: 'STREAMING',
          modelInferenceLatencyMs: processingLatency,
          candidateProcessingLatencyMs: processingLatency,
          inputReadyAtMs,
          inferenceStartAtMs: processingStartAtMs,
          queueDelayMs: processingStartAtMs === undefined ? undefined : processingStartAtMs - inputReadyAtMs,
          publicationDelayMs: processingFinishAtMs === undefined ? undefined : processingFinishAtMs - coverage,
          totalPublicationDelayMs: processingFinishAtMs === undefined ? undefined : processingFinishAtMs - coverage,
        },
      });
      previousCoverage = coverage;
      publicationIndex += 1;
    }
  }
  return {
    candidateId: input.candidateId,
    scenarioId: input.scenario.scenarioId,
    publications,
    runProvenance: {
      command: input.command,
      runtime: input.runtime,
    },
  };
}

export function observationsForOnlineAmtHop(input: {
  scenarioId: string;
  segmentId: string;
  hopIndex: number;
  decisionTimeMs: number;
  pitchStates: readonly OnlineAmtPitchState[];
  previousCoverage: number;
}): readonly CandidateObservation[] {
  const eventTime = eventTimeFromDecisionTimeMs(input.decisionTimeMs);
  if (eventTime < 0 || eventTime <= input.previousCoverage) {
    return [];
  }
  return input.pitchStates
    .filter((state) => ONLINE_AMT_STREAMING_BASELINE_CONFIG.onsetStateIds.includes(state.chosenState as 3 | 4))
    .map((state, ordinal) => ({
      observationId: [
        'oamt',
        sanitize(input.scenarioId),
        sanitize(input.segmentId),
        input.hopIndex,
        sanitize(state.pitch),
        ordinal,
      ].join(':'),
      pitch: state.pitch,
      performanceTimeMs: eventTime,
      confidence: state.probabilities[3] + state.probabilities[4],
    }));
}

export function eventTimeFromDecisionTimeMs(decisionTimeMs: number): number {
  return decisionTimeMs + ONLINE_AMT_STREAMING_BASELINE_CONFIG.timingCorrectionMs;
}

export function assertOnlineAmtAssetIdentity(input: {
  expectedRepoCommit?: string;
  actualRepoCommit?: string;
  expectedCheckpointSha256?: string;
  actualCheckpointSha256?: string;
  expectedCheckpointBytes?: number;
  actualCheckpointBytes?: number;
}): void {
  if (input.expectedRepoCommit && input.actualRepoCommit !== input.expectedRepoCommit) {
    throw new Error('Online-AMT repo commit mismatch.');
  }
  if (input.expectedCheckpointSha256 && !input.actualCheckpointSha256) {
    throw new Error('Online-AMT checkpoint SHA256 identity missing.');
  }
  if (
    input.expectedCheckpointSha256
    && input.actualCheckpointSha256
    && input.expectedCheckpointSha256 !== input.actualCheckpointSha256
  ) {
    throw new Error('Online-AMT checkpoint SHA256 mismatch.');
  }
  if (input.expectedCheckpointBytes !== undefined && input.actualCheckpointBytes === undefined) {
    throw new Error('Online-AMT checkpoint byte size missing.');
  }
  if (
    input.expectedCheckpointBytes !== undefined
    && input.actualCheckpointBytes !== undefined
    && input.expectedCheckpointBytes !== input.actualCheckpointBytes
  ) {
    throw new Error('Online-AMT checkpoint byte size mismatch.');
  }
}

function sanitize(value: string): string {
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
