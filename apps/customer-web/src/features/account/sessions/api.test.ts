// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { accountSessionsApi } from './api';

afterEach(() => vi.unstubAllGlobals());
it('requests a bounded session inventory of 100 through the generated operation', async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => Response.json({sessions: []}));
  vi.stubGlobal('fetch', fetch);
  expect(await accountSessionsApi.getSessions()).toEqual({sessions: []});
  const request = fetch.mock.calls[0][0] as Request;
  const url = new URL(request.url);
  expect(url.pathname).toBe('/api/v1/me/sessions');
  expect(url.searchParams.get('limit')).toBe('100');
});

it('revokes a UUID device or other devices using bodyless commands', async () => {
  const send = vi.fn<typeof fetch>(async () => new Response(null, {status: 204}));
  vi.stubGlobal('fetch', send);
  const id = '113b68e2-23f9-430b-9c42-d031218ae370';
  await expect(accountSessionsApi.revokeSession(id)).resolves.toBeUndefined();
  await expect(accountSessionsApi.revokeOtherSessions()).resolves.toBeUndefined();
  const requests = send.mock.calls.map(([input]) => input as Request);
  expect(requests.map(r => [r.method, new URL(r.url).pathname, r.body])).toEqual([
    ['DELETE', `/api/v1/me/sessions/${id}`, null], ['DELETE', '/api/v1/me/sessions', null],
  ]);
});
