import type {
  LocalPerformanceSessionSnapshot,
  ResolvedPracticeScope,
  ResolvedPracticeTempoPlan,
} from './local-core';

export interface PerformanceReviewDraftAudioReady {
  status: 'READY';
  blob: Blob;
  mimeType: string;
  durationMs: number;
  actualMediaDurationMs?: number;
}

export interface PerformanceReviewDraftAudioUnavailable {
  status: 'UNAVAILABLE';
  reason: string;
}

export type PerformanceReviewDraftAudio =
  | PerformanceReviewDraftAudioReady
  | PerformanceReviewDraftAudioUnavailable;

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

export interface PerformanceReviewDraft {
  localSessionId: string;
  scoreId: string;
  revisionId?: string | null;
  artifactId?: string | null;
  scope: ResolvedPracticeScope;
  tempoPlan: ResolvedPracticeTempoPlan;
  performanceSnapshot: LocalPerformanceSessionSnapshot;
  audio: PerformanceReviewDraftAudio;
  recordingTimebase: RecordingTimebaseMapping;
  replayTiming?: {
    scopeStartBeat: number;
    scopeStartMs: number;
    nominalDurationMs: number;
  };
  completedAt: string;
}

class PerformanceReviewDraftStore {
  private draft: PerformanceReviewDraft | null = null;
  private listeners = new Set<(draft: PerformanceReviewDraft | null) => void>();

  getDraft(): PerformanceReviewDraft | null {
    return this.draft;
  }

  setDraft(draft: PerformanceReviewDraft): void {
    this.draft = draft;
    this.notify();
  }

  clearDraft(): void {
    this.draft = null;
    this.notify();
  }

  subscribe(listener: (draft: PerformanceReviewDraft | null) => void): () => void {
    this.listeners.add(listener);
    listener(this.draft);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener(this.draft);
    }
  }
}

export const performanceReviewDraftStore = new PerformanceReviewDraftStore();
