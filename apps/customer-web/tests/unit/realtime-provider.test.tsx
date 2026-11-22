// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RealtimeProvider } from '@/components/providers/realtime-provider';
import { applyRealtimeCacheChange, serverStateResyncRequired } from '@/lib/cache-effects/realtime';
const transport = vi.hoisted(() => ({
  auth: { isAuthenticated: true, isLoading: false },
  source: { addEventListener: vi.fn(), close: vi.fn() }, create: vi.fn(),
}));
vi.mock('@/features/authentication/session/authentication-context', () => ({ useAuthentication: () => transport.auth }));
vi.mock('@/lib/realtime/event-source', () => ({ createRealtimeEventSource: transport.create }));
vi.mock('@/lib/cache-effects/realtime', () => ({ applyRealtimeCacheChange: vi.fn(), serverStateResyncRequired: vi.fn() }));
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(transport.auth, { isAuthenticated: true, isLoading: false });
  transport.create.mockReturnValue(transport.source);
});
afterEach(cleanup);
function setup() {
  const client = new QueryClient();
  const element = () => <QueryClientProvider client={client}><RealtimeProvider>content</RealtimeProvider></QueryClientProvider>;
  const view = render(element());
  const listeners = new Map(transport.source.addEventListener.mock.calls.map(([kind, listener]) => [kind, listener] as const));
  const send = (kind: string, data: unknown) => act(() => {
    listeners.get(kind)(new MessageEvent(kind, { data: JSON.stringify(data) }));
  });
  return { client, send, view, element };
}
const base = { schemaVersion: 1, sequence: 42, changeId: 'change', createdAt: '2026-07-01T00:00:00Z' };
it.each([
  { ...base, kind: 'notifications.changed', notificationId: 'notice' },
  { ...base, kind: 'import_jobs.changed', importJobId: 'job' },
  ...['score.revisions.changed', 'score.derived_assets.changed', 'score.metadata.changed'].map(
    (kind) => ({ ...base, kind, scoreId: 'score', revisionId: 'revision' }),
  ),
])('decodes $kind and delegates to semantic convergence', (change) => {
  const { client, send } = setup(); send('change', change);
  expect(applyRealtimeCacheChange).toHaveBeenCalledExactlyOnceWith(client, change);
  expect(serverStateResyncRequired).not.toHaveBeenCalled();
});
it('accepts checkpoints without a cache effect', () => {
  const { send } = setup();
  send('checkpoint', { schemaVersion: 1, sequence: 0 }); send('checkpoint', { schemaVersion: 1, sequence: 42 });
  expect(applyRealtimeCacheChange).not.toHaveBeenCalled(); expect(serverStateResyncRequired).not.toHaveBeenCalled();
});
it('delegates malformed change, invalid checkpoint and resync controls without replacing the source', () => {
  const { client, send, view, element } = setup();
  send('change', { ...base, kind: 'unknown' }); send('checkpoint', { schemaVersion: 1, sequence: -1 });
  send('resync-required', { schemaVersion: 1, sequence: 42, reason: 'retention_gap' });
  send('resync-required', { schemaVersion: 1, sequence: 0, reason: 'unknown' });
  expect(serverStateResyncRequired).toHaveBeenCalledTimes(4);
  expect(serverStateResyncRequired).toHaveBeenLastCalledWith(client); expect(applyRealtimeCacheChange).not.toHaveBeenCalled();
  view.rerender(element()); expect(transport.create).toHaveBeenCalledOnce(); expect(transport.source.close).not.toHaveBeenCalled();
  expect(transport.source.addEventListener.mock.calls.map(([kind]) => kind)).toEqual(['checkpoint', 'change', 'resync-required']);
  view.unmount(); expect(transport.source.close).toHaveBeenCalledOnce();
});
it.each([{ isAuthenticated: false, isLoading: false }, { isAuthenticated: true, isLoading: true }])(
  'gates the source on settled authentication: %j', (auth) => {
    Object.assign(transport.auth, auth); const { view } = setup();
    expect(transport.create).not.toHaveBeenCalled(); view.unmount(); expect(transport.source.close).not.toHaveBeenCalled();
  },
);
