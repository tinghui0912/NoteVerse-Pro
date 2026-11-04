import { beforeEach, describe, expect, it, vi } from 'vitest';
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
          { success: false },
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

  it('uses public error fields from api responses without retaining internal details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        Response.json(
          {
            success: false,
            public_code: 'score_preview_failed',
            public_message: 'score_preview_failed',
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
      message: 'score_preview_failed',
    } satisfies Partial<ApiError>);
    expect(capturedError).not.toHaveProperty('details');
  });
});
