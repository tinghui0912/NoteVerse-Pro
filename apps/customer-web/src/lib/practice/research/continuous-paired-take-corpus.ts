import { createHash } from 'node:crypto';

import { validateBenchmarkScenario, type BenchmarkScenario } from './continuous-analyzer-bakeoff';

type Split = 'DEVELOPMENT' | 'CALIBRATION' | 'EVALUATION';
type CompletionKind = 'NATURAL' | 'MANUAL';
type SyncQuality = 'SHARED_CAPTURE_CLOCK_VERIFIED' | 'CALIBRATED_OFFSET' | 'INSUFFICIENT_SYNCHRONIZATION';
type CandidateId = 'bytedance-score-aware-chunked-dev-v1' | 'online-amt-stateful-modern-compat-dev-v1';

export type ContinuousPairedTakeManifest = {
  schemaVersion: 1;
  manifestId: string;
  split: Split;
  takes: readonly ContinuousPairedTake[];
  evaluationLock?: {
    locked: boolean;
    manifestSha256: string;
    policyVersion: string;
  };
};

export type ContinuousPairedTake = {
  takeId: string;
  captureSessionId: string;
  split: Split;
  product: {
    configuredBpm: number;
    scopeId: string;
    startPerformanceTimeMs: 0;
    completion: { kind: CompletionKind; performanceTimeMs: number };
    pauseIntervalsMs?: readonly { startMs: number; endMs: number }[];
  };
  score: {
    practiceScoreArtifactSha256: string;
    practiceScoreArtifactVersion: string;
    sourceScorePath?: string;
    sourceScoreSha256?: string;
    expectedStrikes: BenchmarkScenario['expectedStrikes'];
  };
  audio: {
    path: string;
    sha256: string;
    sampleRateHz: number;
    channelCount: number;
    encoding: string;
    durationMs: number;
    performanceOriginSourceMs: number;
    preRollMs: number;
    postRollMs: number;
  };
  midi: {
    path: string;
    sha256: string;
    sameTake: true;
    noteOns: readonly {
      eventId: string;
      pitch: string;
      performanceTimeMs: number;
      velocity?: number;
    }[];
    rawControlEventCount?: number;
  };
  segments: readonly {
    segmentId: string;
    sourcePerformanceStartSampleBoundary: number;
    sourcePerformanceEndSampleBoundary: number;
    sourceContextTailEndSampleBoundary: number;
    performanceStartMs: number;
    performanceEndMs: number;
  }[];
  sync: {
    quality: SyncQuality;
    method: string;
    offsetMs?: number;
    uncertaintyMs?: number;
    calibrationArtifactSha256?: string;
  };
  taxonomy: readonly string[];
  captureInstructions?: readonly string[];
  performerId?: string;
  setupId?: string;
  pieceId?: string;
};

export type ContinuousCorpusAudit = {
  takeCount: number;
  scoreableTakeCount: number;
  blockedTakeCount: number;
  countsBySplit: Record<Split, number>;
  countsByFamily: Record<string, number>;
  blockers: Record<string, string[]>;
  splitLeakage: string[];
  candidateEligibility: Record<CandidateId, Record<string, 'ELIGIBLE' | 'INELIGIBLE_INSUFFICIENT_CONTEXT'>>;
};

export function validateContinuousPairedTakeManifest(manifest: ContinuousPairedTakeManifest): void {
  if (manifest.schemaVersion !== 1 || !manifest.manifestId) {
    throw new Error('Continuous paired take manifest requires schemaVersion 1 and manifestId.');
  }
  const takeIds = new Set<string>();
  for (const take of manifest.takes) {
    if (takeIds.has(take.takeId)) throw new Error(`Duplicate takeId: ${take.takeId}`);
    takeIds.add(take.takeId);
    validateContinuousPairedTake(take);
  }
  const leakage = detectContinuousSplitLeakage(manifest.takes);
  if (leakage.length > 0) throw new Error(`Continuous paired take split leakage: ${leakage.join('; ')}`);
}

export function validateContinuousPairedTake(take: ContinuousPairedTake): void {
  if (!take.takeId || !take.captureSessionId) throw new Error('Continuous paired take requires take and session identity.');
  if (!take.midi.sameTake) throw new Error('Physical MIDI must be from the same take as microphone audio.');
  if (!take.product.completion || !Number.isFinite(take.product.completion.performanceTimeMs)) {
    throw new Error('Continuous paired take requires authoritative completion.');
  }
  if (!Number.isFinite(take.product.configuredBpm) || take.product.configuredBpm <= 0) {
    throw new Error('Continuous paired take requires configured BPM.');
  }
  if (!take.score.practiceScoreArtifactSha256 || take.score.expectedStrikes.length === 0) {
    throw new Error('Expected score must come from PracticeScoreArtifact, not physical MIDI.');
  }
  if (take.score.expectedStrikes.length === take.midi.noteOns.length) {
    const sameAsMidi = take.score.expectedStrikes.every((strike, index) => (
      strike.pitch === take.midi.noteOns[index]?.pitch
      && strike.expectedPerformanceTimeMs === take.midi.noteOns[index]?.performanceTimeMs
    ));
    if (sameAsMidi) throw new Error('Expected score cannot be derived from physical MIDI.');
  }
  if (!take.audio.sha256 || !take.midi.sha256) throw new Error('Audio and MIDI hashes are required.');
  if (take.sync.quality === 'INSUFFICIENT_SYNCHRONIZATION') {
    throw new Error('Insufficient synchronization blocks scoreability.');
  }
  validateSegments(take);
  const physicalIds = new Set<string>();
  for (const event of take.midi.noteOns) {
    if (physicalIds.has(event.eventId)) throw new Error('Physical MIDI event ids must remain distinct.');
    physicalIds.add(event.eventId);
    if (event.performanceTimeMs > take.product.completion.performanceTimeMs) {
      throw new Error('Physical MIDI event cannot occur after completion.');
    }
  }
}

export function importContinuousPairedTakeAsBenchmarkScenario(take: ContinuousPairedTake): BenchmarkScenario {
  validateContinuousPairedTake(take);
  const scenario: BenchmarkScenario = {
    scenarioId: take.takeId,
    schemaVersion: 1,
    split: take.split,
    familyTags: take.taxonomy,
    source: {
      sourceAudioPath: take.audio.path,
      sourceAudioSha256: take.audio.sha256,
      sourceMidiPath: take.midi.path,
      sourceMidiSha256: take.midi.sha256,
      provenance: 'CONTINUOUS_PAIRED_TAKE_MANIFEST_V1',
    },
    audio: {
      nativeSampleRateHz: take.audio.sampleRateHz,
      channelPolicy: `${take.audio.channelCount}_channel_${take.audio.encoding}`,
      clipStartMs: 0,
      clipEndMs: take.audio.durationMs,
      performanceOriginSourceMs: take.audio.performanceOriginSourceMs,
      sourceDurationMs: take.audio.durationMs,
      pcmIdentity: take.audio.sha256,
    },
    expectedStrikes: take.score.expectedStrikes,
    physicalGroundTruth: {
      status: 'RECORDED',
      sourceKind: 'PAIRED_PHYSICAL_MIDI',
      source: take.midi.path,
      attacks: take.midi.noteOns.map((event) => ({
        physicalEventId: event.eventId,
        pitch: event.pitch,
        performanceTimeMs: event.performanceTimeMs,
      })),
    },
    completion: take.product.completion,
    taxonomy: { groups: Object.fromEntries(take.taxonomy.map((tag) => [tag, [tag]])) },
    corpusOverlapStatus: 'UNKNOWN',
  };
  validateBenchmarkScenario(scenario);
  return scenario;
}

export function auditContinuousPairedTakeCorpus(manifest: ContinuousPairedTakeManifest): ContinuousCorpusAudit {
  const blockers: Record<string, string[]> = {};
  const countsBySplit = { DEVELOPMENT: 0, CALIBRATION: 0, EVALUATION: 0 };
  const countsByFamily: Record<string, number> = {};
  let scoreableTakeCount = 0;
  for (const take of manifest.takes) {
    countsBySplit[take.split] += 1;
    for (const tag of take.taxonomy) countsByFamily[tag] = (countsByFamily[tag] ?? 0) + 1;
    try {
      importContinuousPairedTakeAsBenchmarkScenario(take);
      scoreableTakeCount += 1;
    } catch (error) {
      blockers[take.takeId] = [error instanceof Error ? error.message : String(error)];
    }
  }
  return {
    takeCount: manifest.takes.length,
    scoreableTakeCount,
    blockedTakeCount: manifest.takes.length - scoreableTakeCount,
    countsBySplit,
    countsByFamily,
    blockers,
    splitLeakage: detectContinuousSplitLeakage(manifest.takes),
    candidateEligibility: {
      'bytedance-score-aware-chunked-dev-v1': Object.fromEntries(manifest.takes.map((take) => [
        take.takeId,
        take.audio.preRollMs >= 2000 && take.audio.postRollMs >= 2000 ? 'ELIGIBLE' : 'INELIGIBLE_INSUFFICIENT_CONTEXT',
      ])),
      'online-amt-stateful-modern-compat-dev-v1': Object.fromEntries(manifest.takes.map((take) => [
        take.takeId,
        take.audio.postRollMs >= 2000 ? 'ELIGIBLE' : 'INELIGIBLE_INSUFFICIENT_CONTEXT',
      ])),
    },
  };
}

function detectContinuousSplitLeakage(takes: readonly ContinuousPairedTake[]): string[] {
  const byIdentity = new Map<string, Set<Split>>();
  for (const take of takes) {
    for (const identity of [take.audio.sha256, take.midi.sha256, take.captureSessionId]) {
      const splits = byIdentity.get(identity) ?? new Set<Split>();
      splits.add(take.split);
      byIdentity.set(identity, splits);
    }
  }
  return [...byIdentity.entries()]
    .filter(([, splits]) => splits.size > 1)
    .map(([identity, splits]) => `${identity} appears in splits ${[...splits].sort().join(',')}`);
}

export function canonicalManifestSha256(manifest: ContinuousPairedTakeManifest): string {
  return createHash('sha256').update(canonicalJson(manifest)).digest('hex');
}

function validateSegments(take: ContinuousPairedTake): void {
  const seen = new Set<string>();
  let previousPerformanceEnd = -Infinity;
  for (const segment of take.segments) {
    if (!segment.segmentId || seen.has(segment.segmentId)) throw new Error('Segments require unique non-empty ids.');
    seen.add(segment.segmentId);
    if (
      segment.sourcePerformanceStartSampleBoundary < 0
      || segment.sourcePerformanceEndSampleBoundary < segment.sourcePerformanceStartSampleBoundary
      || segment.sourceContextTailEndSampleBoundary < segment.sourcePerformanceEndSampleBoundary
    ) {
      throw new Error('Source sample boundaries must be half-open and ordered.');
    }
    if (segment.performanceStartMs < previousPerformanceEnd) {
      throw new Error('Pause/resume segments must not overlap in performance time.');
    }
    if (segment.performanceEndMs > take.product.completion.performanceTimeMs) {
      throw new Error('Context tail must not extend performance ownership beyond completion.');
    }
    previousPerformanceEnd = segment.performanceEndMs;
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
    .join(',')}}`;
}
