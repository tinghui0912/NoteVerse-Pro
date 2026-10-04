import type {
  ResolvedPracticeScope,
  ResolvedPracticeTempoPlan,
} from './local-core';

type CompletedObservedAttackRecord = {
  observationId: string;
  pitch: string;
  performanceTimeMs: number;
  confidence: number;
  source: 'ACOUSTIC' | 'MIDI';
  expectedGroupId?: string;
};

type CompletedStrikeRecordBase = {
  strikeId: string;
  expectedGroupId: string;
  pitch: string;
  performanceTimeMs: number;
  renderNoteIds: string[];
};

type CompletedMatchedStrikeRecord = CompletedStrikeRecordBase & {
  result: 'MATCHED';
  matchedObservationId: string;
  confidence: number;
  source: 'ACOUSTIC' | 'MIDI';
  timingOffsetMs: number;
};

type CompletedStrikeRecord =
  | CompletedMatchedStrikeRecord
  | (CompletedStrikeRecordBase & { result: 'MISSING' | 'NOT_REACHED' });

type ContinuousEvaluationUnavailableReason =
  | 'CONTINUOUS_ANALYSIS_UNAVAILABLE'
  | 'INCOMPLETE_ANALYSIS'
  | 'CORRUPT_TRANSIENT_DRAFT';

export type CompletedContinuousEvaluation =
  | {
      status: 'COMPLETE';
      strikes: CompletedStrikeRecord[];
      extras: CompletedObservedAttackRecord[];
    }
  | {
      status: 'UNAVAILABLE';
      reason: ContinuousEvaluationUnavailableReason;
    };

interface PerformanceMediaReadyBase {
  status: 'READY';
  blob: Blob;
  mimeType: string;
  durationMs: number;
  actualMediaDurationMs?: number;
}

export type PerformanceMediaReady =
  | (PerformanceMediaReadyBase & { kind: 'AUDIO' })
  | (PerformanceMediaReadyBase & { kind: 'VIDEO' });

interface PerformanceMediaUnavailable {
  status: 'UNAVAILABLE';
  reason: string;
}

export type PerformanceMedia = PerformanceMediaReady | PerformanceMediaUnavailable;

interface RecordingActiveSegment {
  perfStartMs: number;
  perfEndMs: number;
  mediaStartMs: number;
  mediaEndMs: number;
}

export interface RecordingTimebaseMapping {
  activeSegments: RecordingActiveSegment[];
  nominalMediaDurationMs: number;
}

/**
 * Maps audio media playback time (ms) to practice performanceTimeMs (ms).
 * Takes into account recording start offset, pause/resume intervals, and actual media duration scaling.
 * Returns null if synchronization cannot be reliably determined (allowing explicit degradation).
 */
export function mediaTimeToPerformanceTimeMs(
  mediaTimeMs: number,
  timebase?: RecordingTimebaseMapping | null,
  actualMediaDurationMs?: number | null
): number | null {
  if (!timebase || timebase.activeSegments.length === 0) {
    return null;
  }

  const { activeSegments, nominalMediaDurationMs } = timebase;

  let scaledMediaTimeMs = mediaTimeMs;
  if (
    actualMediaDurationMs &&
    actualMediaDurationMs > 0 &&
    nominalMediaDurationMs > 0
  ) {
    scaledMediaTimeMs = (mediaTimeMs / actualMediaDurationMs) * nominalMediaDurationMs;
  }

  const firstSeg = activeSegments[0];
  const lastSeg = activeSegments[activeSegments.length - 1];

  if (scaledMediaTimeMs <= firstSeg.mediaStartMs) {
    return firstSeg.perfStartMs;
  }
  if (scaledMediaTimeMs >= lastSeg.mediaEndMs) {
    return lastSeg.perfEndMs;
  }

  for (let i = 0; i < activeSegments.length; i++) {
    const seg = activeSegments[i];
    if (scaledMediaTimeMs >= seg.mediaStartMs && scaledMediaTimeMs <= seg.mediaEndMs) {
      const offsetInSeg = scaledMediaTimeMs - seg.mediaStartMs;
      return seg.perfStartMs + offsetInSeg;
    }
  }

  return null;
}

export interface CompletedPerformance {
  localSessionId: string;
  scoreId: string;
  revisionId: string;
  artifactId: string;
  scope: ResolvedPracticeScope;
  tempoPlan: ResolvedPracticeTempoPlan;
  inputSource: 'MICROPHONE' | 'MIDI';
  activeElapsedMs: number;
  evaluation: CompletedContinuousEvaluation;
  media: PerformanceMedia;
  recordingTimebase: RecordingTimebaseMapping;
  completedAt: string;
}

function assertCompletedPerformance(performance: CompletedPerformance): void {
  if (performance.evaluation.status === 'UNAVAILABLE') {
    return;
  }
  if (!Array.isArray(performance.evaluation.strikes) || !Array.isArray(performance.evaluation.extras)) {
    throw new Error('CompletedPerformance evaluation is corrupt.');
  }
  for (const strike of performance.evaluation.strikes) {
    if (!Array.isArray(strike.renderNoteIds)) {
      throw new Error('CompletedPerformance strike renderNoteIds are required.');
    }
    if (strike.result === 'MATCHED') {
      if (
        !strike.matchedObservationId ||
        !Number.isFinite(strike.confidence) ||
        !Number.isFinite(strike.timingOffsetMs)
      ) {
        throw new Error('CompletedPerformance matched strike metadata is required.');
      }
    }
  }
}

class CompletedPerformanceStore {
  private performance: CompletedPerformance | null = null;
  private listeners = new Set<(performance: CompletedPerformance | null) => void>();

  getPerformance(): CompletedPerformance | null {
    return this.performance;
  }

  setPerformance(performance: CompletedPerformance): void {
    assertCompletedPerformance(performance);
    this.performance = performance;
    this.notify();
  }

  clearPerformance(): void {
    this.performance = null;
    this.notify();
  }

  subscribe(listener: (performance: CompletedPerformance | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.performance);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.performance);
    }
  }
}

export const completedPerformanceStore = new CompletedPerformanceStore();
