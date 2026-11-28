// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { authenticationApi } from './api';

afterEach(() => vi.unstubAllGlobals());

it('uses the email JSON contract and returns the canonical login principal', async () => {
  const principal = {id: 1, email: 'member@example.com', display_name: 'Member', is_active: true};
  const send = vi.fn<typeof fetch>(async () => Response.json(principal));
  vi.stubGlobal('fetch', send);
  expect(await authenticationApi.login(principal.email, 'correct-password')).toEqual(principal);
  const request = send.mock.calls[0][0] as Request;
  expect(request.headers.get('content-type')).toBe('application/json');
  expect(await request.json()).toEqual({email: principal.email, password: 'correct-password'});
  expect(request.credentials).toBe('same-origin');
});

it('awaits the bodyless logout acknowledgment', async () => {
  const send = vi.fn<typeof fetch>(async () => new Response(null, {status: 204}));
  vi.stubGlobal('fetch', send);
  await expect(authenticationApi.logout()).resolves.toBeUndefined();
  const request = send.mock.calls[0][0] as Request;
  expect(request.method).toBe('POST');
  expect(new URL(request.url).pathname).toBe('/api/v1/auth/logout');
  expect(request.body).toBeNull();
});
