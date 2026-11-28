import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import {
  authLogin,
  authLogout,
  accountAvatarUpload,
  guestPreviewGet,
  importJobArtifactDownload,
  performanceTakeDelete,
  scoreInvitesCreate,
  scoreInvitesList,
  scoresGet,
  type ApiErrorResponse,
} from '@/generated/api';
import {
  createCustomerBrowserTransport,
  ApiError,
  responseComplete,
} from '@/lib/http/customer-browser-transport';
import { reportClientError } from '@/lib/observability';
import { subscribeToSessionInvalidation } from '@/lib/http/session-invalidation';

vi.mock('@/lib/observability', () => ({ reportClientError: vi.fn() }));
const success = () => Response.json({});
const noContent = () => new Response(null, { status: 204 });
const unauthorized = () =>
  Response.json({ code: 'auth_failed', request_id: 'req-auth' } satisfies ApiErrorResponse, {
    status: 401,
  });
const inviteBody = { email: 'member@example.test', role: 'VIEWER' as const };
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => vi.unstubAllGlobals());
function transport(send: typeof fetch, onUnauthorized = vi.fn()) {
  return createCustomerBrowserTransport({
    baseUrl: 'http://browser.test',
    fetch: send,
    onUnauthorized,
  });
}
const requestAt = (send: ReturnType<typeof vi.fn<typeof fetch>>, index = 0) =>
  send.mock.calls[index][0] as Request;

it('sends JSON login and consumes the principal response', async () => {
  const principal = {
    id: 1,
    email: 'a@example.com',
    display_name: 'A',
    is_active: true,
  };
  const send = vi.fn<typeof fetch>(async () => Response.json(principal));
  const result = await authLogin({
    ...transport(send).public,
    body: { email: principal.email, password: 'correct-password' },
  });
  expect(result.data).toEqual(principal);
  expect(requestAt(send).headers.get('Content-Type')).toBe('application/json');
  expect(await requestAt(send).json()).toEqual({
    email: principal.email,
    password: 'correct-password',
  });
  expect(send).toHaveBeenCalledOnce();
});

it('publishes unauthorized state once per failed request without resending it', async () => {
  const invalidated = vi.fn();
  const stop = subscribeToSessionInvalidation(invalidated);
  const send = vi.fn<typeof fetch>(async () => unauthorized());
  const redirect = vi.fn();
  try {
    await expect(
      scoresGet({
        ...transport(send, redirect).authenticated,
        path: { score_id: 'score' },
      }),
    ).rejects.toBeInstanceOf(ApiError);
    expect(send).toHaveBeenCalledOnce();
    expect(invalidated).toHaveBeenCalledOnce();
    expect(redirect).toHaveBeenCalledOnce();
  } finally {
    stop();
  }
});

it.each(['public', 'silent'] as const)(
  'keeps expected %s unauthorized probes local',
  async (profile) => {
    const invalidated = vi.fn();
    const stop = subscribeToSessionInvalidation(invalidated);
    const send = vi.fn<typeof fetch>(async () => unauthorized());
    const redirect = vi.fn();
    try {
      await expect(
        scoresGet({
          ...transport(send, redirect)[profile],
          path: { score_id: 'score' },
        }),
      ).rejects.toMatchObject({ status: 401 });
      expect(send).toHaveBeenCalledOnce();
      expect(redirect).not.toHaveBeenCalled();
      expect(invalidated).not.toHaveBeenCalled();
    } finally {
      stop();
    }
  },
);

it('sends an unsafe request with explicit JSON transport', async () => {
  const send = vi.fn<typeof fetch>(async () => new Response(null, { status: 403 }));
  await expect(
    scoreInvitesCreate({
      ...transport(send).authenticated,
      path: { score_id: 'score' },
      body: inviteBody,
    }),
  ).rejects.toMatchObject({ status: 403 });
  expect(send).toHaveBeenCalledOnce();
});

it('acknowledges bodyless logout and deletion commands', async () => {
  const send = vi.fn<typeof fetch>(async () => noContent());
  const options = transport(send).authenticated;
  await expect(responseComplete(authLogout(options))).resolves.toBeUndefined();
  await expect(
    responseComplete(performanceTakeDelete({ ...options, path: { take_id: 'take' } })),
  ).resolves.toBeUndefined();
  expect(requestAt(send).body).toBeNull();
});

it('propagates cancellation while the request is in flight', async () => {
  const controller = new AbortController();
  const send = vi.fn<typeof fetch>(async () => {
    controller.abort();
    return success();
  });
  await expect(
    scoresGet({
      ...transport(send).authenticated,
      path: { score_id: 'score' },
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(send).toHaveBeenCalledOnce();
});

it('uses generated paths, path escaping and opaque query serialization', async () => {
  const send = vi.fn<typeof fetch>(async () => success());
  const clients = transport(send);
  await scoreInvitesList({
    ...clients.authenticated,
    path: { score_id: 'score/a' },
    query: { limit: 25, cursor: 'opaque+/=?' },
  });
  const request = requestAt(send);
  const url = new URL(request.url);
  expect(url.pathname).toBe('/api/v1/scores/score%2Fa/invites');
  expect(Object.fromEntries(url.searchParams)).toEqual({
    limit: '25',
    cursor: 'opaque+/=?',
  });
  expect(request.method).toBe('GET');
  expect(request.credentials).toBe('same-origin');
});

it('sends generated JSON with cookie credentials', async () => {
  const send = vi.fn<typeof fetch>(async () => success());
  await scoreInvitesCreate({
    ...transport(send).authenticated,
    path: { score_id: 'score' },
    body: inviteBody,
  });
  const request = requestAt(send);
  expect(request.method).toBe('POST');
  expect(request.headers.get('Content-Type')).toBe('application/json');
  expect(await request.json()).toEqual(inviteBody);
});

it('uses generated multipart encoding with a browser-supplied boundary', async () => {
  const send = vi.fn<typeof fetch>(async () => success());
  await accountAvatarUpload({
    ...transport(send).authenticated,
    body: {
      file: new File(['score bytes'], 'score.xml', { type: 'application/xml' }),
    },
  });
  const request = requestAt(send);
  expect(request.headers.get('Content-Type')).toMatch(/^multipart\/form-data; boundary=/);
  const file = (await request.formData()).get('file') as File;
  expect(file.name).toBe('score.xml');
  expect(await file.text()).toBe('score bytes');
});

it('gets binary and raw streaming responses from generated operations', async () => {
  const send = vi.fn<typeof fetch>(
    async () =>
      new Response('binary bytes', {
        headers: { 'Content-Type': 'application/octet-stream' },
      }),
  );
  const clients = transport(send);
  const blob = await importJobArtifactDownload({
    ...clients.authenticated,
    path: { job_id: 'job', artifact_id: 'artifact' },
    parseAs: 'blob',
  });
  expect(await blob.data.text()).toBe('binary bytes');
  const raw = await importJobArtifactDownload({
    ...clients.authenticated,
    path: { job_id: 'job', artifact_id: 'artifact' },
    headers: { Range: 'bytes=0-3' },
    parseAs: 'stream',
  });
  expect(raw.response.bodyUsed).toBe(false);
  expect(requestAt(send, 1).headers.get('Range')).toBe('bytes=0-3');
  expect(await raw.response.text()).toBe('binary bytes');
});

it.each(['public', 'silent'] as const)('never redirects a %s operation', async (profile) => {
  const send = vi.fn<typeof fetch>(async () => unauthorized());
  const redirect = vi.fn();
  await expect(
    scoresGet({
      ...transport(send, redirect)[profile],
      path: { score_id: 's' },
    }),
  ).rejects.toMatchObject({ status: 401 });
  expect(redirect).not.toHaveBeenCalled();
  expect(send).toHaveBeenCalledTimes(1);
});

it('propagates an already aborted caller signal without a network request', async () => {
  const send = vi.fn<typeof fetch>();
  const controller = new AbortController();
  controller.abort();
  await expect(
    scoresGet({
      ...transport(send).authenticated,
      path: { score_id: 's' },
      signal: controller.signal,
    }),
  ).rejects.toMatchObject({ name: 'AbortError' });
  expect(send).not.toHaveBeenCalled();
});

it.each([400, 401, 403, 404, 409, 422, 500, 503])(
  'projects generated application errors at HTTP %s',
  async (status) => {
    const payload = {
      code: 'business_rule_violation',
      request_id: 'support-id',
    } satisfies ApiErrorResponse;
    const send = vi.fn<typeof fetch>(async () =>
      Response.json(payload, {
        status,
        headers: { 'X-Request-ID': 'proxy-header' },
      }),
    );
    await expect(
      scoresGet({ ...transport(send).public, path: { score_id: 's' } }),
    ).rejects.toMatchObject({
      status,
      code: payload.code,
      requestId: 'support-id',
      message: payload.code,
    });
  },
);

it.each([
  'not-json',
  '{',
  'null',
  '[]',
  '{"code":123}',
  '{"code":"failure"}',
  '{"code":"failure","request_id":null}',
  '{"code":"failure","request_id":""}',
])('handles malformed failure body %s defensively', async (body) => {
  const send = vi.fn<typeof fetch>(
    async () =>
      new Response(body, {
        status: 503,
        headers: { 'X-Request-ID': 'header-id' },
      }),
  );
  await expect(
    scoresGet({ ...transport(send).public, path: { score_id: 's' } }),
  ).rejects.toMatchObject({
    status: 503,
    code: 'internal_error',
    requestId: 'header-id',
  });
});

it('keeps server correlation absent for a noncanonical response without a header', async () => {
  const send = vi.fn<typeof fetch>(async () => new Response('proxy failure', { status: 503 }));
  await expect(
    scoresGet({ ...transport(send).public, path: { score_id: 's' } }),
  ).rejects.toMatchObject({
    status: 503,
    code: 'internal_error',
    requestId: undefined,
  });
});

it('reports network failures while redacting Guest Preview bearer material', async () => {
  const error = new TypeError('network down');
  const send = vi.fn<typeof fetch>(async () => {
    throw error;
  });
  await expect(
    guestPreviewGet({
      ...transport(send).public,
      path: { token: 'private-token' },
    }),
  ).rejects.toBe(error);
  expect(reportClientError).toHaveBeenCalledWith(error, {
    area: 'customer_http',
    action: 'fetch',
    method: 'GET',
    path: '/api/v1/guest-previews/[redacted]',
  });
});

it('uses the normal browser login redirect after the final authenticated 401', async () => {
  const location = {
    origin: 'http://browser.test',
    pathname: '/en/library',
    search: '',
    hash: '',
    href: 'http://browser.test/en/library',
  };
  vi.stubGlobal('window', { location });
  const send = vi.fn<typeof fetch>(async () => unauthorized());
  const clients = createCustomerBrowserTransport({
    baseUrl: 'http://browser.test',
    fetch: send,
  });
  await expect(
    scoresGet({ ...clients.authenticated, path: { score_id: 's' } }),
  ).rejects.toMatchObject({ status: 401 });
  expect(location.href).toContain('/en/auth/login');
});

it.each([400, 503])('rejects unknown codes as noncanonical at HTTP %s', async (status) => {
  const send = vi.fn<typeof fetch>(async () =>
    Response.json({ code: 'server_code', request_id: 'valid-request' }, { status }),
  );
  await expect(
    scoresGet({ ...transport(send).public, path: { score_id: 's' } }),
  ).rejects.toMatchObject({
    code: status >= 500 ? 'internal_error' : 'unknown_error',
    requestId: undefined,
  });
});

it.each([
  { code: 'validation_error', request_id: '_invalid' },
  { code: 'validation_error', request_id: 'valid', details: 'private' },
  { code: '', request_id: 'valid' },
])('rejects noncanonical application facts %j', async (body) => {
  const send = vi.fn<typeof fetch>(async () => Response.json(body, { status: 422 }));
  await expect(
    scoresGet({ ...transport(send).public, path: { score_id: 's' } }),
  ).rejects.toMatchObject({ code: 'unknown_error' });
});

it('uses browser credentials without reading document cookies', async () => {
  vi.stubGlobal('document', {
    get cookie(): string {
      throw new Error('HttpOnly credentials belong to the browser');
    },
  });
  const send = vi.fn<typeof fetch>(async () => noContent());
  await responseComplete(authLogout(transport(send).authenticated));
  const request = requestAt(send);
  expect(request.credentials).toBe('same-origin');
  expect([...request.headers.keys()]).toEqual([]);
  expect(request.body).toBeNull();
});

it.each(['rate_limit_exceeded', 'rate_limit_unavailable', 'unsupported_media_type'] as const)(
  'preserves the structured %s admission error',
  async (code) => {
    const send = vi.fn<typeof fetch>(async () =>
      Response.json(
        { code, request_id: 'admission-rejected' },
        {
          status:
            code === 'rate_limit_exceeded' ? 429 : code === 'rate_limit_unavailable' ? 503 : 415,
        },
      ),
    );
    await expect(
      authLogin({
        ...transport(send).public,
        body: { email: 'user@example.com', password: 'correct-password' },
      }),
    ).rejects.toMatchObject({ code, requestId: 'admission-rejected' });
    expect(send).toHaveBeenCalledOnce();
  },
);
