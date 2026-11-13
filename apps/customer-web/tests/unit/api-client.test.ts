import { beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import type { ApiErrorResponse, AuthLoginErrors, PlaybackPerformancePlanCreateErrors, GuestPreviewPlaybackStreamErrors, HealthReadyErrors, ReadinessUnavailableRead } from '@/generated/api';
import { ApiError, apiClient } from '@/lib/api-client';
import { reportClientError } from '@/lib/observability';

vi.mock('@/lib/observability', () => ({ reportClientError: vi.fn() }));

describe('api client error contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('passes POST cancellation to the existing fetch transport', async () => {
    const signal = new AbortController().signal;
    const fetch = vi.fn().mockResolvedValue(new Response('{}', { headers: { 'content-type': 'application/json' } }));
    vi.stubGlobal('fetch', fetch);
    await apiClient.post('/playback/performance-plan', { musicxml: '<score-partwise/>' }, { signal });
    expect(fetch).toHaveBeenCalledWith('/api/v1/playback/performance-plan', expect.objectContaining({ method: 'POST', signal }));
  });

  it('redacts Guest Preview bearer material from transport error context', async () => {
    const failure = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(failure));
    await expect(apiClient.get('/guest-previews/private-token')).rejects.toBe(failure);
    expect(reportClientError).toHaveBeenLastCalledWith(failure, {
      area: 'api_client', action: 'fetch', method: 'GET',
      path: '/api/v1/guest-previews/[redacted]',
    });
  });

  it('uses a stable error code for non-json server failures', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response('Internal Server Error', {
          status: 500,
          statusText: 'Internal Server Error',
          headers: { 'content-type': 'text/plain' },
        })
      )
    );

    await expect(apiClient.get('/scores')).rejects.toMatchObject({
      status: 500,
      code: 'internal_error',
      message: 'internal_error',
    } satisfies Partial<ApiError>);
  });

  it('does not expose http status text when json error bodies omit business codes', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          { malformed: true },
          {
            status: 500,
            statusText: 'Internal Server Error',
          }
        )
      )
    );

    await expect(apiClient.get('/scores')).rejects.toMatchObject({
      status: 500,
      code: 'internal_error',
      message: 'internal_error',
    } satisfies Partial<ApiError>);
  });

  it('uses generated error codes and correlation without retaining server details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            ...({ code: 'score_preview_failed', request_id: 'req-preview' } satisfies ApiErrorResponse),
            internal_details: { engine: 'internal-renderer' },
          },
          { status: 500 }
        )
      )
    );

    let capturedError: unknown;
    try {
      await apiClient.get('/scores/score-1');
    } catch (error) {
      capturedError = error;
    }

    expect(capturedError).toMatchObject({
      status: 500,
      code: 'score_preview_failed',
      requestId: 'req-preview',
      message: 'score_preview_failed',
    } satisfies Partial<ApiError>);
    expect(capturedError).not.toHaveProperty('details');
  });
});


it('projects operation failures from the canonical generated schema', () => {
  expectTypeOf<AuthLoginErrors[422]>().toEqualTypeOf<ApiErrorResponse>();
  expectTypeOf<AuthLoginErrors['default']>().toEqualTypeOf<ApiErrorResponse>();
  expectTypeOf<PlaybackPerformancePlanCreateErrors[422]>().toEqualTypeOf<ApiErrorResponse>();
  expectTypeOf<GuestPreviewPlaybackStreamErrors['default']>().toEqualTypeOf<ApiErrorResponse>();
  expectTypeOf<HealthReadyErrors[503]>().toEqualTypeOf<ReadinessUnavailableRead>();
});

it.each([null, [], 'not-an-object', 123, { code: 123, request_id: [] }])(
  'handles malformed JSON error payload %j defensively', async (payload) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload, {
      status: 503, headers: { 'X-Request-ID': 'fallback-id' },
    })));
    await expect(apiClient.get('/scores')).rejects.toMatchObject({
      status: 503, code: 'internal_error', requestId: 'fallback-id',
    });
  }
);

it('handles unreadable JSON errors defensively', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{', {
    status: 500, headers: { 'content-type': 'application/json' },
  })));
  await expect(apiClient.get('/scores')).rejects.toMatchObject({ code: 'internal_error' });
});

it.each([400, 403, 404, 409, 422, 500, 503])('retains the canonical code and HTTP status %s', async (status) => {
  const payload = { code: 'business_failure', request_id: null } satisfies ApiErrorResponse;
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(payload, { status })));
  await expect(apiClient.get('/scores')).rejects.toMatchObject({ status, code: payload.code });
});
