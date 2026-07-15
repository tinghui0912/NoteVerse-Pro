import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api-client';

describe('api client error contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it('uses public error fields from api responses', async () => {
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

    await expect(apiClient.get('/scores/score-1')).rejects.toMatchObject({
      status: 500,
      code: 'score_preview_failed',
      message: 'score_preview_failed',
      details: { engine: 'internal-renderer' },
    } satisfies Partial<ApiError>);
  });
});
