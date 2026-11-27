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
