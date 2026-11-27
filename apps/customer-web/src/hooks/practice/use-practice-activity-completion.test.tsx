// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';
import { usePracticeActivityCompletion } from './use-practice-activity-completion';
import { completedContinuousSessionFixture } from '@/lib/practice/__fixtures__/continuous-result';
import { continuousPracticePlan } from '@/lib/practice/__fixtures__/practice-plan';
import artifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { PracticeScoreArtifact } from '@/lib/practice/score/artifact';

const fake = vi.hoisted(() => ({ create: vi.fn(), report: vi.fn() }));
vi.mock('@/lib/api', () => ({ practiceApi: { createActivity: fake.create } }));
vi.mock('@/lib/observability', () => ({ reportClientError: fake.report }));
beforeEach(() => { vi.clearAllMocks(); fake.create.mockResolvedValue({ activity_id: 'activity', completed_at: '2026-11-17T00:00:00Z' }); });
const completed = () => completedContinuousSessionFixture(continuousPracticePlan(artifactJson as PracticeScoreArtifact));
it('repeated callbacks and rerenders submit one request per local execution', () => {
  const hook = renderHook(() => usePracticeActivityCompletion());
  const snapshot = completed();
  act(() => { hook.result.current(snapshot); hook.result.current(snapshot); });
  hook.rerender();
  act(() => hook.result.current(snapshot));
  expect(fake.create).toHaveBeenCalledOnce();
  act(() => hook.result.current({ ...snapshot, localSessionId: 'new-execution' }));
  expect(fake.create).toHaveBeenCalledTimes(2);
  hook.unmount();
});
it('manual stopping and teardown never submit a completion', () => {
  const hook = renderHook(() => usePracticeActivityCompletion());
  act(() => hook.result.current({ ...completed(), completionReason: 'STOPPED_BY_USER' }));
  hook.unmount();
  expect(fake.create).not.toHaveBeenCalled();
});
it('rejected persistence is observed without throwing or unbounded retries', async () => {
  const failure = new Error('network'); fake.create.mockRejectedValue(failure);
  const hook = renderHook(() => usePracticeActivityCompletion());
  const snapshot = completed();
  act(() => { expect(() => hook.result.current(snapshot)).not.toThrow(); });
  await waitFor(() => expect(fake.report).toHaveBeenCalledWith(failure, { operation: 'practice.activity.create', mode: 'CONTINUOUS_PLAY' }));
  act(() => hook.result.current(snapshot));
  expect(fake.create).toHaveBeenCalledOnce();
  hook.unmount();
});
