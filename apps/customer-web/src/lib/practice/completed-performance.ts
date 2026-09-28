import type {
  LocalPerformanceSessionSnapshot,
  ResolvedPracticeScope,
  ResolvedPracticeTempoPlan,
} from './local-core';

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

export interface PerformanceMediaUnavailable {
  status: 'UNAVAILABLE';
  reason: string;
}

export type PerformanceMedia = PerformanceMediaReady | PerformanceMediaUnavailable;

export interface RecordingActiveSegment {
  perfStartMs: number;
  perfEndMs: number;
  mediaStartMs: number;
  mediaEndMs: number;
}

export interface RecordingTimebaseMapping {
  recordingStartPerfTimeMs: number;
  recordingEndPerfTimeMs: number;
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
    if (i < activeSegments.length - 1) {
      const nextSeg = activeSegments[i + 1];
      if (scaledMediaTimeMs > seg.mediaEndMs && scaledMediaTimeMs < nextSeg.mediaStartMs) {
        return seg.perfEndMs;
      }
    }
  }

  return lastSeg.perfEndMs;
}

export interface CompletedPerformance {
  localSessionId: string;
  scoreId: string;
  revisionId: string;
  artifactId: string;
  scope: ResolvedPracticeScope;
  tempoPlan: ResolvedPracticeTempoPlan;
  performanceSnapshot: LocalPerformanceSessionSnapshot;
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
