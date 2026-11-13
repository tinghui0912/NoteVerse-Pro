import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  authLogin, authLogout, authRefresh, filesUpload, guestPreviewGet, importJobArtifactDownload,
  performanceTakeMediaStream, scoreInvitesCreate, scoreInvitesList, scoresGet,
  type ApiErrorResponse,
} from '@/generated/api';
import { createCustomerBrowserTransport, ApiError } from '@/lib/http/customer-browser-transport';
import { CSRF_COOKIE_NAME, CSRF_HEADER_NAME } from '@/lib/app-protocol';
import { reportClientError } from '@/lib/observability';

vi.mock('@/lib/observability', () => ({ reportClientError: vi.fn() }));
const success = () => Response.json({ success: true, data: {} });
const unauthorized = () => Response.json({ code: 'auth_failed', request_id: 'req-auth' } satisfies ApiErrorResponse, { status: 401 });
const inviteBody = { email: 'member@example.test', role: 'VIEWER' as const };
const doc = { cookie: '' };
beforeEach(() => {
  vi.clearAllMocks();
  doc.cookie = `${CSRF_COOKIE_NAME}=csrf-value`;
  vi.stubGlobal('document', doc);
});
afterEach(() => vi.unstubAllGlobals());
function transport(send: typeof fetch, onUnauthorized = vi.fn()) {
  return createCustomerBrowserTransport({ baseUrl: 'http://browser.test', fetch: send, onUnauthorized });
}
const requestAt = (send: ReturnType<typeof vi.fn<typeof fetch>>, index = 0) => send.mock.calls[index][0] as Request;

it('uses generated paths, path escaping and opaque query serialization', async () => {
  const send = vi.fn<typeof fetch>(async () => success());
  const clients = transport(send);
  await scoreInvitesList({ ...clients.authenticated, path: { score_id: 'score/a' }, query: { limit: 25, cursor: 'opaque+/=?' } });
  const request = requestAt(send);
  const url = new URL(request.url);
  expect(url.pathname).toBe('/api/v1/scores/score%2Fa/invites');
  expect(Object.fromEntries(url.searchParams)).toEqual({ limit: '25', cursor: 'opaque+/=?' });
  expect(request.method).toBe('GET');
  expect(request.credentials).toBe('include');
});

it('sends generated JSON with CSRF and cookie credentials', async () => {
  const send = vi.fn<typeof fetch>(async () => success());
  await scoreInvitesCreate({ ...transport(send).authenticated, path: { score_id: 'score' }, body: inviteBody });
  const request = requestAt(send);
  expect(request.method).toBe('POST');
  expect(request.headers.get(CSRF_HEADER_NAME)).toBe('csrf-value');
  expect(request.headers.get('Content-Type')).toBe('application/json');
  expect(await request.json()).toEqual(inviteBody);
});

it('uses generated OAuth form encoding without refreshing an auth-bootstrap request', async () => {
  doc.cookie = '';
  const send = vi.fn<typeof fetch>(async () => success());
  await authLogin({ ...transport(send).public, body: { username: 'a+b@example.test', password: 'x & y' } });
  const request = requestAt(send);
  expect(request.headers.get('Content-Type')).toBe('application/x-www-form-urlencoded');
  expect(Object.fromEntries(new URLSearchParams(await request.text()))).toEqual({ username: 'a+b@example.test', password: 'x & y' });
  expect(send).toHaveBeenCalledTimes(1);
});

it('uses generated multipart encoding with a browser-supplied boundary', async () => {
  const send = vi.fn<typeof fetch>(async () => success());
  await filesUpload({ ...transport(send).authenticated, body: { file: new File(['score bytes'], 'score.xml', { type: 'application/xml' }) } });
  const request = requestAt(send);
  expect(request.headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/);
  const file = (await request.formData()).get('file') as File;
  expect(file.name).toBe('score.xml');
  expect(await file.text()).toBe('score bytes');
});

it('gets binary and raw streaming responses from generated operations', async () => {
  const send = vi.fn<typeof fetch>(async () => new Response('binary bytes', { headers: { 'Content-Type': 'application/octet-stream' } }));
  const clients = transport(send);
  const blob = await importJobArtifactDownload({ ...clients.authenticated, path: { job_id: 'job', artifact_id: 'artifact' }, parseAs: 'blob' });
  expect(await blob.data.text()).toBe('binary bytes');
  const raw = await performanceTakeMediaStream({ ...clients.authenticated, path: { take_id: 'take' }, headers: { Range: 'bytes=0-3' }, parseAs: 'stream' });
  expect(raw.response.bodyUsed).toBe(false);
  expect(requestAt(send, 1).headers.get('Range')).toBe('bytes=0-3');
  expect(await raw.response.text()).toBe('binary bytes');
});

it('bootstraps a missing CSRF cookie through generated refresh before the unsafe request', async () => {
  doc.cookie = '';
  const send = vi.fn<typeof fetch>(async input => {
    const request = input as Request;
    if (new URL(request.url).pathname.endsWith('/refresh')) doc.cookie = `${CSRF_COOKIE_NAME}=new-csrf`;
    return success();
  });
  await scoreInvitesCreate({ ...transport(send).authenticated, path: { score_id: 'score' }, body: inviteBody });
  expect(send).toHaveBeenCalledTimes(2);
  expect(new URL(requestAt(send).url).pathname).toBe('/api/v1/auth/refresh');
  expect(requestAt(send, 1).headers.get(CSRF_HEADER_NAME)).toBe('new-csrf');
});

it.each(['json', 'form', 'multipart', 'bodyless'] as const)('replays the complete %s request body after one refresh', async kind => {
  const bodies: string[] = [];
  const methods: string[] = [];
  let originalCount = 0;
  let refreshCount = 0;
  const send = vi.fn<typeof fetch>(async input => {
    const request = input as Request;
    if (new URL(request.url).pathname === '/api/v1/auth/refresh') {
      refreshCount++;
      doc.cookie = `${CSRF_COOKIE_NAME}=rotated-csrf`;
      return success();
    }
    bodies.push(await request.text());
    methods.push(request.method);
    return ++originalCount === 1 ? unauthorized() : success();
  });
  const options = transport(send).authenticated;
  if (kind === 'json') await scoreInvitesCreate({ ...options, path: { score_id: 's' }, body: inviteBody });
  if (kind === 'form') await authLogin({ ...options, body: { username: 'user', password: 'secret & value' } });
  if (kind === 'multipart') await filesUpload({ ...options, body: { file: new File(['contents'], 'a.xml') } });
  if (kind === 'bodyless') await authLogout({ ...options });
  expect(refreshCount).toBe(1);
  expect(originalCount).toBe(2);
  expect(bodies[1]).toBe(bodies[0]);
  expect(methods[1]).toBe(methods[0]);
  expect(requestAt(send, 2).headers.get(CSRF_HEADER_NAME)).toBe('rotated-csrf');
});

it('coalesces concurrent 401s including a delayed response into a single refresh', async () => {
  let finishRefresh!: (response: Response) => void;
  const refreshResponse = new Promise<Response>(resolve => { finishRefresh = resolve; });
  const counts = new Map<string, number>();
  const send = vi.fn<typeof fetch>(async input => {
    const path = new URL((input as Request).url).pathname;
    if (path.endsWith('/refresh')) return refreshResponse;
    const count = (counts.get(path) ?? 0) + 1;
    counts.set(path, count);
    return count === 1 ? unauthorized() : success();
  });
  const clients = transport(send);
  const first = scoresGet({ ...clients.authenticated, path: { score_id: 'a' } });
  const second = scoresGet({ ...clients.authenticated, path: { score_id: 'b' } });
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(3));
  finishRefresh(success());
  await Promise.all([first, second]);
  expect(send.mock.calls.filter(([input]) => new URL((input as Request).url).pathname.endsWith('/refresh'))).toHaveLength(1);
});

it('stops after a failed refresh and redirects an authenticated final 401 once', async () => {
  const send = vi.fn<typeof fetch>(async () => unauthorized());
  const redirect = vi.fn();
  await expect(scoresGet({ ...transport(send, redirect).authenticated, path: { score_id: 's' } })).rejects.toBeInstanceOf(ApiError);
  expect(send).toHaveBeenCalledTimes(2);
  expect(redirect).toHaveBeenCalledTimes(1);
});

it('does not recursively refresh the refresh operation', async () => {
  const send = vi.fn<typeof fetch>(async () => unauthorized());
  await expect(authRefresh({ ...transport(send).public })).rejects.toMatchObject({ status: 401 });
  expect(send).toHaveBeenCalledTimes(1);
});

it.each(['public', 'silent'] as const)('never redirects a %s operation', async profile => {
  const send = vi.fn<typeof fetch>(async () => unauthorized());
  const redirect = vi.fn();
  await expect(scoresGet({ ...transport(send, redirect)[profile], path: { score_id: 's' } })).rejects.toMatchObject({ status: 401 });
  expect(redirect).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(profile === 'public' ? 1 : 2);
});

it('does not loop after a successful refresh followed by another 401', async () => {
  const send = vi.fn<typeof fetch>(async input => new URL((input as Request).url).pathname.endsWith('/refresh') ? success() : unauthorized());
  await expect(scoresGet({ ...transport(send).authenticated, path: { score_id: 's' } })).rejects.toMatchObject({ status: 401 });
  expect(send).toHaveBeenCalledTimes(3);
});

it('propagates an already aborted caller signal without a network request', async () => {
  const send = vi.fn<typeof fetch>();
  const controller = new AbortController();
  controller.abort();
  await expect(scoresGet({ ...transport(send).authenticated, path: { score_id: 's' }, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(send).not.toHaveBeenCalled();
});

it('abandons a caller aborted during shared refresh without replaying it', async () => {
  let finishRefresh!: (response: Response) => void;
  const refreshResponse = new Promise<Response>(resolve => { finishRefresh = resolve; });
  const send = vi.fn<typeof fetch>(async input => new URL((input as Request).url).pathname.endsWith('/refresh') ? refreshResponse : unauthorized());
  const controller = new AbortController();
  const request = scoresGet({ ...transport(send).authenticated, path: { score_id: 's' }, signal: controller.signal });
  const failed = expect(request).rejects.toMatchObject({ name: 'AbortError' });
  await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(2));
  controller.abort();
  await failed;
  finishRefresh(success());
  await Promise.resolve();
  expect(send).toHaveBeenCalledTimes(2);
});

it('propagates cancellation while the retried request is in flight', async () => {
  const controller = new AbortController();
  let attempts = 0;
  const send = vi.fn<typeof fetch>(async input => {
    const request = input as Request;
    if (new URL(request.url).pathname.endsWith('/refresh')) return success();
    if (++attempts === 1) return unauthorized();
    controller.abort();
    request.signal.throwIfAborted();
    return success();
  });
  await expect(scoresGet({ ...transport(send).authenticated, path: { score_id: 's' }, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' });
  expect(attempts).toBe(2);
});

it.each([400, 401, 403, 404, 409, 422, 500, 503])('projects generated application errors at HTTP %s', async status => {
  const payload = { code: 'business_failure', request_id: 'support-id' } satisfies ApiErrorResponse;
  const send = vi.fn<typeof fetch>(async () => Response.json(payload, { status }));
  await expect(scoresGet({ ...transport(send).public, path: { score_id: 's' } })).rejects.toMatchObject({ status, code: payload.code, requestId: 'support-id', message: payload.code });
});

it.each(['not-json', '{', 'null', '[]', '{"code":123}'])('handles malformed failure body %s defensively', async body => {
  const send = vi.fn<typeof fetch>(async () => new Response(body, { status: 503, headers: { 'X-Request-ID': 'header-id' } }));
  await expect(scoresGet({ ...transport(send).public, path: { score_id: 's' } })).rejects.toMatchObject({ status: 503, code: 'internal_error', requestId: 'header-id' });
});

it('reports network failures while redacting Guest Preview bearer material', async () => {
  const error = new TypeError('network down');
  const send = vi.fn<typeof fetch>(async () => { throw error; });
  await expect(guestPreviewGet({ ...transport(send).public, path: { token: 'private-token' } })).rejects.toBe(error);
  expect(reportClientError).toHaveBeenCalledWith(error, {
    area: 'customer_http', action: 'fetch', method: 'GET', path: '/api/v1/guest-previews/[redacted]',
  });
});


it('reuses the completed refresh when a concurrent original 401 arrives later', async () => {
  let releaseLate!: (response: Response) => void;
  const late = new Promise<Response>(resolve => { releaseLate = resolve; });
  let a = 0, b = 0, refreshes = 0;
  const send = vi.fn<typeof fetch>(async input => {
    const path = new URL((input as Request).url).pathname;
    if (path.endsWith('/refresh')) { refreshes++; return success(); }
    if (path.endsWith('/a')) return ++a === 1 ? unauthorized() : success();
    return ++b === 1 ? late : success();
  });
  const clients = transport(send);
  const first = scoresGet({ ...clients.authenticated, path: { score_id: 'a' } });
  const second = scoresGet({ ...clients.authenticated, path: { score_id: 'b' } });
  await first;
  releaseLate(unauthorized());
  await second;
  expect(refreshes).toBe(1);
  expect(a).toBe(2);
  expect(b).toBe(2);
});

it('uses the normal browser login redirect after the final authenticated 401', async () => {
  const location = { origin: 'http://browser.test', pathname: '/en/library', search: '', hash: '', href: 'http://browser.test/en/library' };
  vi.stubGlobal('window', { location });
  const send = vi.fn<typeof fetch>(async () => unauthorized());
  const clients = createCustomerBrowserTransport({ baseUrl: 'http://browser.test', fetch: send });
  await expect(scoresGet({ ...clients.authenticated, path: { score_id: 's' } })).rejects.toMatchObject({ status: 401 });
  expect(location.href).toContain('/en/auth/login');
});

it('reuses a bootstrap refresh for a single retry when the first unsafe request returns 401', async () => {
  doc.cookie = '';
  let requests = 0, refreshes = 0;
  const send = vi.fn<typeof fetch>(async input => {
    if (new URL((input as Request).url).pathname.endsWith('/refresh')) {
      refreshes++;
      doc.cookie = `${CSRF_COOKIE_NAME}=new-csrf`;
      return success();
    }
    return ++requests === 1 ? unauthorized() : success();
  });
  await scoreInvitesCreate({ ...transport(send).authenticated, path: { score_id: 's' }, body: inviteBody });
  expect(refreshes).toBe(1);
  expect(requests).toBe(2);
});
