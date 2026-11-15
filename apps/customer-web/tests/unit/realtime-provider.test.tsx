// @vitest-environment jsdom
import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeProvider } from '@/components/providers/realtime-provider';
import { queryKeys } from '@/lib/query-client';
const source = vi.hoisted(() => ({
  addEventListener: vi.fn(),
  close: vi.fn(),
}));
vi.mock('@/contexts/auth-context', () => ({
  useAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));
vi.mock('@/lib/realtime/event-source', () => ({
  createRealtimeEventSource: () => source,
}));
afterEach(() => vi.clearAllMocks());
function setup() {
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, 'invalidateQueries');
  const view = render(
    <QueryClientProvider client={client}>
      <RealtimeProvider>content</RealtimeProvider>
    </QueryClientProvider>
  );
  const listeners = new Map(
    source.addEventListener.mock.calls.map(([kind, listener]) => [kind, listener])
  );
  const send = (kind: string, data: unknown) =>
    act(() => listeners.get(kind)(new MessageEvent(kind, { data: JSON.stringify(data) })));
  return { invalidate, send, view };
}
const base = {
  schemaVersion: 1,
  sequence: 42,
  changeId: 'change',
  createdAt: '2026-07-01T00:00:00Z',
};
describe('realtime cache convergence', () => {
  it('invalidates notification list/count for notifications.changed', () => {
    const { send, invalidate, view } = setup();
    send('change', {
      ...base,
      kind: 'notifications.changed',
      notificationId: 'notice',
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.notifications.list(),
    });
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: queryKeys.notifications.unreadCount(),
    });
    view.unmount();
    expect(source.close).toHaveBeenCalledOnce();
  });
  it('invalidates import lists independently from notification queries', () => {
    const { send, invalidate, view } = setup();
    send('change', {
      ...base,
      kind: 'import_jobs.changed',
      importJobId: 'job',
    });
    expect(invalidate).toHaveBeenCalledExactlyOnceWith({
      queryKey: queryKeys.importJobs.lists(),
    });
    view.unmount();
  });
  it.each(['score.revisions.changed', 'score.derived_assets.changed', 'score.metadata.changed'])(
    'invalidates score and library for %s',
    (kind) => {
      const { send, invalidate, view } = setup();
      send('change', { ...base, kind, scoreId: 'score', revisionId: 'revision' });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.scores.detail('score'),
      });
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.library.scores(),
      });
      if (kind === 'score.revisions.changed')
        expect(invalidate).toHaveBeenCalledWith({
          queryKey: queryKeys.scores.revisions('score'),
        });
      if (kind !== 'score.metadata.changed')
        expect(invalidate).toHaveBeenCalledWith({
          predicate: expect.any(Function),
        });
      view.unmount();
    }
  );
  it('broadly refetches for resync and malformed changes without replacing the source', () => {
    const { send, invalidate, view } = setup();
    send('resync-required', {
      schemaVersion: 1,
      sequence: 42,
      reason: 'retention_gap',
    });
    send('change', { ...base, kind: 'unknown' });
    expect(invalidate.mock.calls).toEqual([[], []]);
    expect(source.close).not.toHaveBeenCalled();
    expect(source.addEventListener.mock.calls.map(([name]) => name)).toEqual([
      'change',
      'resync-required',
    ]);
    view.unmount();
  });
});
