import type {
  LocalPerformanceExpectedEventOutcomeRecord,
  LocalPracticeCompletionReason,
  ResolvedPracticeScope,
  ResolvedPracticeTempoPlan,
} from './local-core';

type CompletedStrikeResult = 'MATCHED' | 'MISSING' | 'NOT_REACHED';

type CompletedObservedAttackRecord = {
  observationId: string;
  pitch: string;
  performanceTimeMs: number;
  confidence: number;
  source: 'ACOUSTIC' | 'MIDI' | 'FAKE';
  expectedGroupId?: string;
};

type CompletedStrikeRecord = {
  strikeId: string;
  expectedGroupId: string;
  pitch: string;
  performanceTimeMs: number;
  renderNoteIds: string[];
  result: CompletedStrikeResult;
  confidence: number;
  source: 'ACOUSTIC' | 'MIDI' | 'FAKE';
  timingOffsetMs?: number;
};

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

export function completedEvaluationFromPerformanceOutcomes(
  outcomes: readonly LocalPerformanceExpectedEventOutcomeRecord[],
  completionReason: LocalPracticeCompletionReason | null
): CompletedContinuousEvaluation {
  const strikes: CompletedStrikeRecord[] = [];
  const extras: CompletedObservedAttackRecord[] = [];

  for (const outcome of outcomes) {
    assertOutcomeShape(outcome);
    for (const strike of outcome.expectedStrikeOutcomes) {
      if (strike.result === 'UNCONFIRMED') {
        if (completionReason === 'STOPPED_BY_USER') {
          strikes.push({
            strikeId: strike.strikeId,
            expectedGroupId: outcome.expectedGroupId,
            pitch: strike.pitch,
            performanceTimeMs: outcome.performanceTimeMs,
            renderNoteIds: [...strike.renderNoteIds],
            result: 'NOT_REACHED',
            confidence: outcome.confidence,
            source: outcome.source,
            timingOffsetMs: outcome.timingOffsetMs,
          });
          continue;
        }
        return { status: 'UNAVAILABLE', reason: 'INCOMPLETE_ANALYSIS' };
      }
      strikes.push({
        strikeId: strike.strikeId,
        expectedGroupId: outcome.expectedGroupId,
        pitch: strike.pitch,
        performanceTimeMs: outcome.performanceTimeMs,
        renderNoteIds: [...strike.renderNoteIds],
        result: strike.result,
        confidence: outcome.confidence,
        source: outcome.source,
        timingOffsetMs: outcome.timingOffsetMs,
      });
    }
    outcome.unexpectedPitches.forEach((pitch, index) => {
      extras.push({
        observationId: `${outcome.expectedGroupId}:extra:${index}:${pitch}`,
        pitch,
        performanceTimeMs: outcome.performanceTimeMs,
        confidence: outcome.confidence,
        source: outcome.source,
        expectedGroupId: outcome.expectedGroupId,
      });
    });
  }

  return { status: 'COMPLETE', strikes, extras };
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
  }
}

function assertOutcomeShape(outcome: LocalPerformanceExpectedEventOutcomeRecord): void {
  if (!Array.isArray(outcome.expectedStrikeOutcomes) || !Array.isArray(outcome.unexpectedPitches)) {
    throw new Error('Local performance outcome is corrupt.');
  }
  for (const strike of outcome.expectedStrikeOutcomes) {
    if (!Array.isArray(strike.renderNoteIds)) {
      throw new Error('Local performance strike renderNoteIds are required.');
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
