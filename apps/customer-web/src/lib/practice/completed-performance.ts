import { assertCompletedEvaluation } from '@/lib/practice/continuous/domain/evaluation/session';
import type { ResolvedPracticeScope } from '@/lib/practice/kernel/scope';
import type { ResolvedPracticeTempoPlan } from '@/lib/practice/kernel/tempo';
import { immutableContinuousValue } from '@/lib/practice/continuous/domain/evaluation/immutable-value';
import { type CompletedContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/evaluation-types';

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

interface PerformanceMediaNotRecorded {
  status: 'NOT_RECORDED';
}

export type PerformanceMedia =
  | PerformanceMediaReady
  | PerformanceMediaNotRecorded
  | PerformanceMediaUnavailable;

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

class CompletedPerformanceStore {
  private performance: CompletedPerformance | null = null;
  private listeners = new Set<(performance: CompletedPerformance | null) => void>();

  getPerformance(): CompletedPerformance | null {
    return this.performance;
  }

  setPerformance(performance: CompletedPerformance): void {
    assertCompletedEvaluation(performance.evaluation, performance.inputSource);
    this.performance = { ...performance,
      evaluation: Object.isFrozen(performance.evaluation) ? performance.evaluation
        : immutableContinuousValue(structuredClone(performance.evaluation)) };
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
