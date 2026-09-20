import { describe, expect, it } from 'vitest';
import {
  performanceReviewDraftStore,
  type PerformanceReviewDraft,
} from './performance-review-draft';

describe('PerformanceReviewDraftStore', () => {
  it('stores, retrieves, clears and notifies subscribers of draft', () => {
    performanceReviewDraftStore.clearDraft();
    expect(performanceReviewDraftStore.getDraft()).toBeNull();

    const notifications: (PerformanceReviewDraft | null)[] = [];
    const unsubscribe = performanceReviewDraftStore.subscribe((draft) => {
      notifications.push(draft);
    });

    const mockDraft: PerformanceReviewDraft = {
      localSessionId: 'sess-123',
      scoreId: 'score-abc',
      revisionId: 'rev-1',
      artifactId: 'art-1',
      scope: {
        startIndex: 0,
        endIndex: 2,
        startBeat: 0,
        terminalBeat: 8,
      },
      tempoPlan: {
        selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 90 },
        segments: [{ startBeat: 0, bpm: 90, source: 'CUSTOM' }],
      },
      performanceSnapshot: {
        localSessionId: 'sess-123',
        scoreId: 'score-abc',
        revisionId: 'rev-1',
        artifactId: 'art-1',
        mode: 'CONTINUOUS_PLAY',
        inputSource: 'MICROPHONE',
        tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 90 },
        metronomeEnabled: false,
        lifecycleState: 'ENDED',
        completionReason: 'SCOPE_COMPLETED',
        version: { schemaVersion: 1, runtimeVersion: '1.0.0' },
        createdAtMs: 1000,
        updatedAtMs: 5000,
        performance: {
          state: 'ENDED',
          stateBeforePause: 'RUNNING',
          resolvedTempoPlan: {
            selection: { mode: 'CUSTOM_FIXED_BPM', bpm: 90 },
            segments: [{ startBeat: 0, bpm: 90, source: 'CUSTOM' }],
          },
          scopeStartBeat: 0,
          scopeTerminalBeat: 8,
          activeElapsedMs: 4000,
          countInMs: 2000,
          countInBeats: 4,
          countInPulses: 4,
          observations: [],
          outcomes: [],
        },
      },
      audio: {
        status: 'READY',
        blob: new Blob(['audio-data'], { type: 'audio/webm' }),
        mimeType: 'audio/webm',
        durationMs: 4000,
      },
      replayTiming: {
        scopeStartBeat: 0,
        scopeStartMs: 0,
        nominalDurationMs: 5333,
      },
      completedAt: '2026-09-20T12:00:00.000Z',
    };

    performanceReviewDraftStore.setDraft(mockDraft);
    expect(performanceReviewDraftStore.getDraft()).toEqual(mockDraft);

    performanceReviewDraftStore.clearDraft();
    expect(performanceReviewDraftStore.getDraft()).toBeNull();

    unsubscribe();
    expect(notifications).toEqual([null, mockDraft, null]);
  });
});
