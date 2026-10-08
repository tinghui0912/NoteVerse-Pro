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

const ONLINE_AMT_MODERN_COMPAT_EXECUTION_PROFILE = {
  profileId: 'online-amt-modern-compat-python-cpu-stateful-v1',
  legacyRuntimeParity: 'UNPROVEN',
  candidateInferenceConcurrency: 1,
  authoritativeDevice: 'CPU',
  browserSupport: 'NOT_EVALUATED',
} as const;

type OnlineAmtProbabilities = readonly [number, number, number, number, number];

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
  performancePcm16k: Float32Array;
  contextTailPcm16k: Float32Array;
};

export type OnlineAmtSegmentDiagnostics = {
  segmentId: string;
  performanceOwnedSamples: number;
  availableContextTailSamples: number;
  requiredContextTailSamples: number;
  lastSafeCoverageMs: number;
  segmentPerformanceEndMs: number;
  coverageComplete: boolean;
};

export type OnlineAmtPythonHopArtifact = {
  schemaVersion: 1;
  artifact: 'online_amt_real_hop_output';
  segments: readonly {
    segmentId: string;
    performanceStartMs: number;
    performanceOwnedSamples: number;
    contextTailSamples: number;
    hops: readonly {
      hopIndex: number;
      localDecisionSample: number;
      processingLatencyMs?: number;
      pitchStates: readonly OnlineAmtPitchState[];
    }[];
  }[];
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
  const diagnostics = validateOnlineAmtSegments(input.scenario, input.segments);
  const hopSegments = input.segments.map((segment) => {
    const required = onlineAmtSegmentTailRequirement(segment.performancePcm16k.length);
    const stream = concatFloat32(segment.performancePcm16k, segment.contextTailPcm16k);
    const hopCount = Math.floor(Math.min(stream.length, required.requiredProcessedSamples) / ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopSamples);
    input.engine.reset();
    return {
      segmentId: segment.segmentId,
      performanceStartMs: segment.performanceStartMs,
      performanceOwnedSamples: segment.performancePcm16k.length,
      hops: Array.from({ length: hopCount }, (_, hopIndex) => {
        const hopStartSample = hopIndex * ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopSamples;
        const hop = stream.slice(hopStartSample, hopStartSample + ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopSamples);
        return {
          hopIndex,
          localDecisionSample: hopStartSample + ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopSamples,
          output: input.engine.processHop(hop),
        };
      }),
    };
  });
  const publications = publicationsFromHopOutputs({
    scenarioId: input.scenario.scenarioId,
    hopSegments,
    omitAvailabilityAcrossSegments: input.segments.length > 1,
  });
  return {
    candidateId: input.candidateId,
    scenarioId: input.scenario.scenarioId,
    publications,
    runProvenance: {
      command: input.command,
      runtime: input.runtime,
      environment: {
        streamingContractSmoke: 'STREAMING_CONTRACT_SMOKE_ONLY',
        segmentDiagnostics: JSON.stringify(diagnostics),
      },
    },
  };
}

export function runOnlineAmtStreamingCandidateFromHopArtifact(input: {
  scenario: BenchmarkScenario;
  artifact: OnlineAmtPythonHopArtifact;
  candidateId: string;
  command: string;
  runtime: string;
}): CandidateScenarioRun {
  const artifact = parseOnlineAmtPythonHopArtifact(input.artifact);
  const publications = publicationsFromHopOutputs({
    scenarioId: input.scenario.scenarioId,
    hopSegments: artifact.segments.map((segment) => ({
      segmentId: segment.segmentId,
      performanceStartMs: segment.performanceStartMs,
      performanceOwnedSamples: segment.performanceOwnedSamples,
      hops: segment.hops.map((hop) => ({
        hopIndex: hop.hopIndex,
        localDecisionSample: hop.localDecisionSample,
        output: {
          pitchStates: hop.pitchStates,
          processingLatencyMs: hop.processingLatencyMs,
        },
      })),
    })),
    omitAvailabilityAcrossSegments: artifact.segments.length > 1,
  });
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

function publicationsFromHopOutputs(input: {
  scenarioId: string;
  hopSegments: readonly {
    segmentId: string;
    performanceStartMs: number;
    performanceOwnedSamples: number;
    hops: readonly {
      hopIndex: number;
      localDecisionSample: number;
      output: OnlineAmtHopOutput;
    }[];
  }[];
  omitAvailabilityAcrossSegments: boolean;
}): CandidatePublication[] {
  const publications: CandidatePublication[] = [];
  let previousCoverage = -Infinity;
  let publicationIndex = 0;
  for (const segment of input.hopSegments) {
    let previousProcessingFinish: number | undefined;
    const segmentEndMs = performanceEndMs(segment.performanceStartMs, segment.performanceOwnedSamples);
    for (const hop of segment.hops) {
      const localDecisionTimeMs = samplesToMs(hop.localDecisionSample);
      const decisionTimeMs = segment.performanceStartMs + localDecisionTimeMs;
      const correctedEventFrontierMs = eventTimeFromSegmentLocalDecisionMs(
        segment.performanceStartMs,
        localDecisionTimeMs,
      );
      if (correctedEventFrontierMs < segment.performanceStartMs) {
        continue;
      }
      const coverage = Math.min(segmentEndMs, correctedEventFrontierMs);
      if (coverage < previousCoverage) {
        throw new Error('Online-AMT streaming coverage moved backward.');
      }
      const observations = observationsForOnlineAmtHop({
        scenarioId: input.scenarioId,
        segmentId: segment.segmentId,
        hopIndex: hop.hopIndex,
        segmentPerformanceStartMs: segment.performanceStartMs,
        segmentPerformanceEndMs: segmentEndMs,
        localDecisionTimeMs,
        pitchStates: hop.output.pitchStates,
        previousCoverage,
      });
      const processingLatency = hop.output.processingLatencyMs;
      const inputReadyAtMs = decisionTimeMs;
      const canPublishAvailability = !input.omitAvailabilityAcrossSegments && processingLatency !== undefined;
      const processingStartAtMs = !canPublishAvailability
        ? undefined
        : Math.max(inputReadyAtMs, previousProcessingFinish ?? inputReadyAtMs);
      const processingFinishAtMs = processingLatency === undefined || processingStartAtMs === undefined
        ? undefined
        : processingStartAtMs + processingLatency;
      if (processingFinishAtMs !== undefined) previousProcessingFinish = processingFinishAtMs;
      publications.push({
        publicationId: `${input.scenarioId}:online-amt:${publicationIndex}`,
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
  return publications;
}

export function observationsForOnlineAmtHop(input: {
  scenarioId: string;
  segmentId: string;
  hopIndex: number;
  segmentPerformanceStartMs?: number;
  segmentPerformanceEndMs?: number;
  localDecisionTimeMs?: number;
  decisionTimeMs?: number;
  pitchStates: readonly OnlineAmtPitchState[];
  previousCoverage: number;
}): readonly CandidateObservation[] {
  const eventTime = input.localDecisionTimeMs === undefined || input.segmentPerformanceStartMs === undefined
    ? eventTimeFromDecisionTimeMs(input.decisionTimeMs ?? 0)
    : eventTimeFromSegmentLocalDecisionMs(input.segmentPerformanceStartMs, input.localDecisionTimeMs);
  const segmentStart = input.segmentPerformanceStartMs ?? 0;
  const segmentEnd = input.segmentPerformanceEndMs ?? Infinity;
  if (eventTime < segmentStart || eventTime > segmentEnd || eventTime <= input.previousCoverage) {
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

export function eventTimeFromSegmentLocalDecisionMs(
  segmentPerformanceStartMs: number,
  localDecisionTimeMs: number,
): number {
  return segmentPerformanceStartMs + localDecisionTimeMs + ONLINE_AMT_STREAMING_BASELINE_CONFIG.timingCorrectionMs;
}

export function onlineAmtSegmentTailRequirement(performanceOwnedSamples: number): {
  correctionDelaySamples: number;
  requiredProcessedSamples: number;
  requiredContextTailSamples: number;
} {
  if (!Number.isInteger(performanceOwnedSamples) || performanceOwnedSamples < 0) {
    throw new Error('Online-AMT performance-owned samples must be a non-negative integer.');
  }
  const correctionDelaySamples = Math.ceil(
    Math.abs(ONLINE_AMT_STREAMING_BASELINE_CONFIG.timingCorrectionMs)
    / 1000
    * ONLINE_AMT_STREAMING_BASELINE_CONFIG.sampleRateHz,
  );
  const requiredProcessedSamples = Math.ceil(
    (performanceOwnedSamples + correctionDelaySamples) / ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopSamples,
  ) * ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopSamples;
  return {
    correctionDelaySamples,
    requiredProcessedSamples,
    requiredContextTailSamples: Math.max(0, requiredProcessedSamples - performanceOwnedSamples),
  };
}

export function validateOnlineAmtSegments(
  scenario: BenchmarkScenario,
  segments: readonly OnlineAmtSegment[],
): readonly OnlineAmtSegmentDiagnostics[] {
  const seen = new Set<string>();
  const completion = scenario.completion?.performanceTimeMs ?? scenario.audio.clipEndMs - scenario.audio.performanceOriginSourceMs;
  let previousEnd = -Infinity;
  return segments.map((segment) => {
    if (!segment.segmentId) throw new Error('Online-AMT segment requires a non-empty segmentId.');
    if (seen.has(segment.segmentId)) throw new Error('Online-AMT segmentId must be unique.');
    seen.add(segment.segmentId);
    if (!Number.isFinite(segment.performanceStartMs) || segment.performanceStartMs < 0) {
      throw new Error('Online-AMT segment requires finite non-negative performanceStartMs.');
    }
    if (segment.performanceStartMs < previousEnd) {
      throw new Error('Online-AMT segment performance ownership cannot overlap.');
    }
    assertFinitePcm(segment.performancePcm16k, 'performancePcm16k');
    assertFinitePcm(segment.contextTailPcm16k, 'contextTailPcm16k');
    const segmentEnd = performanceEndMs(segment.performanceStartMs, segment.performancePcm16k.length);
    if (segmentEnd > completion + 1e-9) {
      throw new Error('Online-AMT segment cannot own performance PCM beyond scenario completion.');
    }
    previousEnd = segmentEnd;
    const requirement = onlineAmtSegmentTailRequirement(segment.performancePcm16k.length);
    const availableSamples = segment.performancePcm16k.length + segment.contextTailPcm16k.length;
    const processedSamples = Math.floor(
      Math.min(availableSamples, requirement.requiredProcessedSamples) / ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopSamples,
    ) * ONLINE_AMT_STREAMING_BASELINE_CONFIG.hopSamples;
    const lastSafeCoverage = Math.min(
      segmentEnd,
      eventTimeFromSegmentLocalDecisionMs(segment.performanceStartMs, samplesToMs(processedSamples)),
    );
    return {
      segmentId: segment.segmentId,
      performanceOwnedSamples: segment.performancePcm16k.length,
      availableContextTailSamples: segment.contextTailPcm16k.length,
      requiredContextTailSamples: requirement.requiredContextTailSamples,
      lastSafeCoverageMs: Math.max(segment.performanceStartMs, lastSafeCoverage),
      segmentPerformanceEndMs: segmentEnd,
      coverageComplete: lastSafeCoverage + 1e-9 >= segmentEnd,
    };
  });
}

export function parseOnlineAmtPythonHopArtifact(value: unknown): OnlineAmtPythonHopArtifact {
  const artifact = value as OnlineAmtPythonHopArtifact;
  if (artifact?.schemaVersion !== 1 || artifact.artifact !== 'online_amt_real_hop_output' || !Array.isArray(artifact.segments)) {
    throw new Error('Malformed Online-AMT hop artifact.');
  }
  for (const segment of artifact.segments) {
    if (!segment.segmentId || !Number.isFinite(segment.performanceStartMs)) {
      throw new Error('Malformed Online-AMT hop artifact segment.');
    }
    if (!Number.isInteger(segment.performanceOwnedSamples) || segment.performanceOwnedSamples < 0) {
      throw new Error('Malformed Online-AMT hop artifact performance sample count.');
    }
    if (!Number.isInteger(segment.contextTailSamples) || segment.contextTailSamples < 0) {
      throw new Error('Malformed Online-AMT hop artifact context sample count.');
    }
    if (!Array.isArray(segment.hops)) throw new Error('Malformed Online-AMT hop artifact hops.');
    for (const hop of segment.hops) {
      if (!Number.isInteger(hop.hopIndex) || hop.hopIndex < 0 || !Number.isInteger(hop.localDecisionSample)) {
        throw new Error('Malformed Online-AMT hop identity.');
      }
      if (hop.processingLatencyMs !== undefined && (!Number.isFinite(hop.processingLatencyMs) || hop.processingLatencyMs < 0)) {
        throw new Error('Malformed Online-AMT hop processing latency.');
      }
      if (!Array.isArray(hop.pitchStates)) throw new Error('Malformed Online-AMT pitch states.');
      for (const state of hop.pitchStates) {
        if (!state.pitch || !Number.isInteger(state.chosenState) || state.probabilities.length !== 5) {
          throw new Error('Malformed Online-AMT pitch state.');
        }
        if (!state.probabilities.every((probability: number) => Number.isFinite(probability))) {
          throw new Error('Online-AMT pitch probabilities must be finite.');
        }
      }
    }
  }
  return artifact;
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

function samplesToMs(samples: number): number {
  return samples / ONLINE_AMT_STREAMING_BASELINE_CONFIG.sampleRateHz * 1000;
}

function performanceEndMs(performanceStartMs: number, performanceOwnedSamples: number): number {
  return performanceStartMs + samplesToMs(performanceOwnedSamples);
}

function concatFloat32(left: Float32Array, right: Float32Array): Float32Array {
  const combined = new Float32Array(left.length + right.length);
  combined.set(left, 0);
  combined.set(right, left.length);
  return combined;
}

function assertFinitePcm(samples: Float32Array, label: string): void {
  if (!(samples instanceof Float32Array)) throw new Error(`Online-AMT ${label} must be Float32Array.`);
  for (const sample of samples) {
    if (!Number.isFinite(sample)) throw new Error(`Online-AMT ${label} samples must be finite.`);
  }
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
