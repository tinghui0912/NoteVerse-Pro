// @vitest-environment jsdom
import { useDeletePerformanceTake, useSavePerformanceTake } from './use-performance-take-queries';
import { PerformanceTakeSaveCommand } from '@/lib/practice/performance-take/save-command';
import { performanceTakesApi } from '@/lib/api/performance-takes';
import type { PerformanceTakeRead, PerformanceTakeTempoPlan, RecordingTimebase } from '@/lib/api/performance-takes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { recordedPerformanceFixture } from '@/lib/practice/__fixtures__/recorded-performance';
import { artifact as videoArtifact } from '@/lib/practice/composite-video/__fixtures__/performance-take';
vi.mock('@/lib/api/performance-takes', () => ({ performanceTakesApi: { deleteTake: vi.fn() } }));
const tempoPlan: PerformanceTakeTempoPlan = {
  selection: { mode: 'SCORE' },
  segments: [{ startTick: 0, bpm: 120, source: 'MUSICXML' }],
};
const recordingTimebase: RecordingTimebase = {
  nominalMediaDurationUs: 1000000,
  activeSegments: [
    {
      performanceStartUs: 0,
      performanceEndUs: 1000000,
      mediaStartUs: 0,
      mediaEndUs: 1000000,
    },
  ],
};
const performanceTake: PerformanceTakeRead = {
  recording_media: { mime_type: 'audio/wav', byte_size: 12 },
  take_id: 'take-1',

  created_at: '2026-09-21T00:00:00Z',
  manifest: {
    artifact_id: videoArtifact.artifactId,
    score_display_title_snapshot: 'Etude',
    score_timebase: { ticks_per_quarter: 1 },
    tempo_plan: tempoPlan,
    recording_timebase: recordingTimebase,
    practice_binding: {
      bundle_id: 'source-1',
      score_id: 'score-1',
      revision_id: 'revision-1',
    },
    capture: {
      kind: 'AUDIO',
      mime_type: 'audio/wav',
      byte_size: 12,
    },
    scope: {
      kind: 'FULL',
      start_tick: 0,
      terminal_tick: 4,
    },
  },
};

beforeEach(() => { vi.restoreAllMocks(); vi.mocked(performanceTakesApi.deleteTake).mockReset(); });
describe('semantic Take deletion cache admission', () => {
  it('removes the resource and corrects paginated totals before background list refresh completes', async () => {
    const { queryKeys } = await import('@/lib/query-client');
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const first = queryKeys.performanceTakes.list({ limit: 1, offset: 0 });
    const second = queryKeys.performanceTakes.list({ limit: 1, offset: 1 });
    const matching = queryKeys.performanceTakes.list({ score_id: 'score-1' });
    const unrelated = queryKeys.performanceTakes.list({ score_id: 'score-2' });
    const other = { ...performanceTake, take_id: 'other' };
    const list = (items: PerformanceTakeRead[], total: number, offset = 0) => ({
        items,
        total,
        limit: 1,
        offset,
        has_more: offset + items.length < total,
      });
    client.setQueryData(first, list([performanceTake], 2));
    client.setQueryData(second, list([other], 2, 1));
    client.setQueryData(matching, list([performanceTake], 1));
    client.setQueryData(unrelated, list([other], 1));
    client.setQueryData(queryKeys.performanceTakes.detail('take-1'), performanceTake);
    client.setQueryData(queryKeys.performanceTakes.playbackUrl('take-1'), { playback_url: 'signed-deleted' });
    client.setQueryData(queryKeys.performanceTakes.playbackUrl('other'), { playback_url: 'signed-other' });
    const invalidate = vi
      .spyOn(client, 'invalidateQueries')
      .mockImplementation(() => new Promise(() => {}));
    vi.mocked(performanceTakesApi.deleteTake).mockResolvedValue(undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useDeletePerformanceTake(), { wrapper });
    await act(async () => {
      await hook.result.current.mutateAsync('take-1');
    });
    expect(client.getQueryData(first)).toMatchObject({ items: [], total: 1, has_more: true });
    expect(client.getQueryData(second)).toMatchObject({ items: [other], total: 1, has_more: false });
    expect(client.getQueryData(matching)).toMatchObject({ items: [], total: 0 });
    expect(client.getQueryData(unrelated)).toMatchObject({ items: [other], total: 1 });
    expect(
      client.getQueryData(queryKeys.performanceTakes.detail('take-1')),
    ).toBeUndefined();
    expect(
      client.getQueryData(queryKeys.performanceTakes.playbackUrl('take-1')),
    ).toBeUndefined();
    expect(
      client.getQueryData(queryKeys.performanceTakes.playbackUrl('other')),
    ).toMatchObject({ playback_url: 'signed-other' });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.storageUsage.all,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.performanceTakes.lists(),
    });
    hook.unmount();
    client.clear();
  });

  it('keeps cached semantic authority when DELETE is rejected', async () => {
    const { queryKeys } = await import('@/lib/query-client');
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const key = queryKeys.performanceTakes.list();
    const cached = { items: [performanceTake], total: 1 };
    client.setQueryData(key, cached);
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    vi.mocked(performanceTakesApi.deleteTake).mockRejectedValue(
      new Error('denied'),
    );
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useDeletePerformanceTake(), { wrapper });
    await act(async () => {
      await expect(hook.result.current.mutateAsync('take-1')).rejects.toThrow(
        'denied',
      );
    });
    expect(client.getQueryData(key)).toEqual(cached);
    expect(invalidate).not.toHaveBeenCalled();
    hook.unmount();
    client.clear();
  });
});

it('cancels stale deleted-resource/list reads while another Take playback remains live', async () => {
  const { queryKeys } = await import('@/lib/query-client');
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  const key = queryKeys.performanceTakes.list();
  client.setQueryData(key, { items: [performanceTake], total: 1, offset: 0 });
  let listSignal!: AbortSignal, otherSignal!: AbortSignal;
  let finishList!: (data: unknown) => void,
    finishOther!: (data: unknown) => void;
  const stale = client
    .fetchQuery({
      queryKey: key,
      queryFn: ({ signal }) => {
        listSignal = signal;
        return new Promise((resolve) => {
          finishList = resolve;
        });
      },
    })
    .catch(() => undefined);
  const other = client.fetchQuery({
    queryKey: queryKeys.performanceTakes.playbackUrl('other'),
    queryFn: ({ signal }) => {
      otherSignal = signal;
      return new Promise((resolve) => {
        finishOther = resolve;
      });
    },
  });
  vi.spyOn(client, 'invalidateQueries').mockResolvedValue();
  vi.mocked(performanceTakesApi.deleteTake).mockResolvedValue(undefined);
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  const hook = renderHook(() => useDeletePerformanceTake(), { wrapper });
  await act(async () => {
    await hook.result.current.mutateAsync('take-1');
  });
  expect(listSignal.aborted).toBe(true);
  expect(otherSignal.aborted).toBe(false);
  finishList({ items: [performanceTake], total: 1 });
  finishOther({ playback_url: 'other-signed-recording' });
  await stale;
  await other;
  expect(client.getQueryData(key)).toMatchObject({ items: [], total: 0 });
  expect(
    client.getQueryData(queryKeys.performanceTakes.playbackUrl('other')),
  ).toMatchObject({ playback_url: 'other-signed-recording' });
  hook.unmount();
  client.clear();
});

it('invokes one Save command and invalidates library and quota cache after success', async () => {
  const client = new QueryClient({defaultOptions: {mutations: {retry: false}}});
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const execute = vi.spyOn(PerformanceTakeSaveCommand.prototype, 'execute').mockResolvedValue(performanceTake);
  const wrapper = ({children}: {children: ReactNode}) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  const {result} = renderHook(() => useSavePerformanceTake(), {wrapper});
  const recording = recordedPerformanceFixture();
  await act(async () => {
    const pending = result.current.mutateAsync({clientRequestId: 'stable-review-id', recordedPerformance: recording});
    expect(await pending).toEqual(performanceTake);
  });
  expect(execute).toHaveBeenCalledOnce();
  expect(invalidate).toHaveBeenCalledTimes(2);
});
