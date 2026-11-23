// @vitest-environment jsdom
import { storageUsageQueryKeys } from '@/features/storage-usage/query-keys';
import { useDeletePerformanceTake, useSavePerformanceTake } from './use-performance-take-queries';
import { PerformanceTakeSaveCommand } from '@/lib/practice/performance-take/save-command';
import { performanceTakesApi } from '@/lib/api/performance-takes';
import type {
  PerformanceTakeRead,
  PerformanceTakeTempoPlan,
  RecordingTimebase,
} from '@/lib/api/performance-takes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook, waitFor } from '@testing-library/react';
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
  it('updates lists immediately and waits for list and storage convergence before completing', async () => {
    const { queryKeys } = await import('@/lib/query-client');
    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });
    const first = queryKeys.performanceTakes.list({ limit: 1 });
    const second = queryKeys.performanceTakes.list({ limit: 20 });
    const matching = queryKeys.performanceTakes.list({ score_id: 'score-1' });
    const unrelated = queryKeys.performanceTakes.list({ score_id: 'score-2' });
    const other = { ...performanceTake, take_id: 'other' };
    const list = (items: PerformanceTakeRead[]) => ({ pages: [{items, next_cursor: null}], pageParams: [undefined] });
    client.setQueryData(first, { pages: [{ items: [other], next_cursor: 'next' }, { items: [performanceTake], next_cursor: null }], pageParams: [undefined, 'next'] });
    client.setQueryData(second, list([other]));
    client.setQueryData(matching, list([performanceTake]));
    client.setQueryData(unrelated, list([other]));
    client.setQueryData(queryKeys.performanceTakes.detail('take-1'), performanceTake);
    client.setQueryData(queryKeys.performanceTakes.playbackUrl('take-1'), { playback_url: 'signed-deleted' });
    client.setQueryData(queryKeys.performanceTakes.playbackUrl('other'), { playback_url: 'signed-other' });
    client.setQueryData(storageUsageQueryKeys.current(), { bytes: 12 });
    const finishInvalidations: Array<() => void> = [];
    const invalidateQueries = client.invalidateQueries.bind(client);
    const invalidate = vi.spyOn(client, 'invalidateQueries').mockImplementation(async (filters, options) => {
      await invalidateQueries(filters, options);
      await new Promise<void>((resolve) => finishInvalidations.push(() => resolve()));
    });
    vi.mocked(performanceTakesApi.deleteTake).mockResolvedValue(undefined);
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const hook = renderHook(() => useDeletePerformanceTake(), { wrapper });
    let completion!: Promise<void>;
    let finished = false;
    await act(async () => {
      completion = hook.result.current.mutateAsync('take-1').then(() => { finished = true; });
    });
    await waitFor(() => expect(finishInvalidations).toHaveLength(2));
    expect(finished).toBe(false);
    expect(client.getQueryData(first)).toMatchObject({ pages: [{ items: [other], next_cursor: 'next' }, { items: [], next_cursor: null }], pageParams: [undefined, 'next'] });
    expect(client.getQueryData(second)).toMatchObject({ pages: [{ items: [other] }] });
    expect(client.getQueryData(matching)).toMatchObject({ pages: [{items: []}] });
    expect(client.getQueryData(unrelated)).toMatchObject({ pages: [{items: [other]}] });
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
      queryKey: storageUsageQueryKeys.all,
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.performanceTakes.lists(),
    });
    expect(client.getQueryState(first)?.isInvalidated).toBe(true);
    expect(client.getQueryState(storageUsageQueryKeys.current())?.isInvalidated).toBe(true);
    await act(async () => { finishInvalidations[0](); });
    expect(finished).toBe(false);
    await act(async () => {
      finishInvalidations[1]();
      await completion;
    });
    expect(finished).toBe(true);
    hook.unmount();
    client.clear();
  });

  it('keeps cached semantic authority when DELETE is rejected', async () => {
    const { queryKeys } = await import('@/lib/query-client');
    const client = new QueryClient({
      defaultOptions: { mutations: { retry: false } },
    });
    const key = queryKeys.performanceTakes.list();
    const cached = { pages: [{items: [performanceTake], next_cursor: null}], pageParams: [undefined] };
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
  client.setQueryData(key, { pages: [{items: [performanceTake], next_cursor: null}], pageParams: [undefined] });
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
  finishList({ pages: [{ items: [performanceTake], next_cursor: null }], pageParams: [undefined] });
  finishOther({ playback_url: 'other-signed-recording' });
  await stale;
  await other;
  expect(client.getQueryData(key)).toMatchObject({ pages: [{items: []}] });
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
