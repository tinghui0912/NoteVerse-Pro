// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { accountSecurityApi } from './api';

afterEach(() => vi.unstubAllGlobals());
it.each(['en', 'zh'] as const)('sends %s locale with the authenticated password-change contract', async (locale) => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, {status: 204}));
  vi.stubGlobal('fetch', fetch);
  await accountSecurityApi.changePassword('current-password', 'new-password', locale);
  const request = fetch.mock.calls.map(([request]) => request as Request).find(request => request.url.endsWith('/me/password'))!;
  expect(request).toBeDefined();
  expect(await request.json()).toEqual({current_password: 'current-password', new_password: 'new-password', locale});
});
