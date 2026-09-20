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
}

export interface PerformanceReviewDraftAudioUnavailable {
  status: 'UNAVAILABLE';
  reason: string;
}

export type PerformanceReviewDraftAudio =
  | PerformanceReviewDraftAudioReady
  | PerformanceReviewDraftAudioUnavailable;

export interface PerformanceReviewDraft {
  localSessionId: string;
  scoreId: string;
  revisionId?: string | null;
  artifactId?: string | null;
  scope: ResolvedPracticeScope;
  tempoPlan: ResolvedPracticeTempoPlan;
  performanceSnapshot: LocalPerformanceSessionSnapshot;
  audio: PerformanceReviewDraftAudio;
  replayTiming: {
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
