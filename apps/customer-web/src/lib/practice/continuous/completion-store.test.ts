import { afterEach, describe, expect, it } from 'vitest';
import { canonicalContinuousResultFixture } from '@/lib/practice/__fixtures__/continuous-result';
import { continuousCompletionStore } from './completion-store';
import type { ContinuousPracticeCompletion } from './completion';

const ready = () => ({ status: 'READY' as const, kind: 'AUDIO' as const, blob: new Blob(['audio']), mimeType: 'audio/webm', durationMs: 1000,
  timebase: { nominalMediaDurationMs: 1000, activeSegments: [{ perfStartMs: 0, perfEndMs: 1000, mediaStartMs: 0, mediaEndMs: 1000 }] } });
afterEach(() => continuousCompletionStore.clearCompletion());
describe('atomic Continuous completion handoff', () => {
  it('notifies once with both artifacts, defensively freezes data, and clears/unsubscribes', () => {
    const notifications: (ContinuousPracticeCompletion | null)[] = [], result = canonicalContinuousResultFixture(), recording = ready();
    const unsubscribe = continuousCompletionStore.subscribe(completion => notifications.push(completion));
    continuousCompletionStore.setCompletion({ result, recording });
    const saved = continuousCompletionStore.getCompletion()!;
    expect(notifications).toEqual([null, saved]); expect(saved.result).toEqual(result); expect(saved.recording).toEqual(recording);
    recording.timebase.activeSegments[0].perfEndMs = 2000;
    expect(saved.recording.status === 'READY' && saved.recording.timebase.activeSegments[0].perfEndMs).toBe(1000);
    expect(Object.isFrozen(saved)).toBe(true); expect(Object.isFrozen(saved.result.evaluation)).toBe(true);
    expect(Object.isFrozen(saved.recording)).toBe(true);
    continuousCompletionStore.clearCompletion(); expect(notifications).toEqual([null, saved, null]);
    unsubscribe(); continuousCompletionStore.clearCompletion(); expect(notifications).toHaveLength(3);
  });
  it('rejects either corrupt artifact without publishing a partial replacement', () => {
    const completion: ContinuousPracticeCompletion = { result: canonicalContinuousResultFixture(), recording: ready() };
    continuousCompletionStore.setCompletion(completion); const original = continuousCompletionStore.getCompletion();
    const observed: unknown[] = [], unsubscribe = continuousCompletionStore.subscribe(value => observed.push(value));
    const corrupt = JSON.parse(JSON.stringify(completion.result)); corrupt.metrics = {};
    expect(() => continuousCompletionStore.setCompletion({ ...completion, result: corrupt })).toThrow();
    const corruptAssignment = JSON.parse(JSON.stringify(completion.result));
    delete corruptAssignment.evaluation.assignment.groups[0].strikes[0].renderNoteIds;
    expect(() => continuousCompletionStore.setCompletion({ ...completion, result: corruptAssignment })).toThrow('Continuous assignment strike renderNoteIds are required.');
    expect(() => continuousCompletionStore.setCompletion({ ...completion, recording: { ...ready(), timebase: { nominalMediaDurationMs: -1, activeSegments: [] } } })).toThrow();
    expect(continuousCompletionStore.getCompletion()).toBe(original); expect(observed).toEqual([original]); unsubscribe();
  });
  it('analysis-unavailable may have ready media; complete evaluation may have unavailable media', () => {
    continuousCompletionStore.setCompletion({ result: canonicalContinuousResultFixture('MICROPHONE', 48000, false), recording: ready() });
    expect(continuousCompletionStore.getCompletion()).toMatchObject({ result: { evaluation: { status: 'UNAVAILABLE' },
      evidenceProvenance: { inputSource: 'MICROPHONE', sourceSampleRateHz: 48000 } }, recording: { status: 'READY' } });
    continuousCompletionStore.setCompletion({ result: canonicalContinuousResultFixture(), recording: { status: 'UNAVAILABLE', reason: 'NotAllowedError' } });
    expect(continuousCompletionStore.getCompletion()).toMatchObject({ result: { evaluation: { status: 'COMPLETE' } }, recording: { status: 'UNAVAILABLE' } });
  });
});
