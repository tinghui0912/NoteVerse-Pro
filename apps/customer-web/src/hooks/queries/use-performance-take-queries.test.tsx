// @vitest-environment jsdom

import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  performanceTakesApi,
  uploadMediaToSignedUrl,
  type PerformanceTakeRead,
} from '@/lib/api/performance-takes';
import { useSavePerformanceTake } from '@/hooks/queries/use-performance-take-queries';

vi.mock('@/lib/api/performance-takes', () => ({
  performanceTakesApi: {
    authorizeUpload: vi.fn(),
    cancelUploadAuthorization: vi.fn(),
    finalizeTake: vi.fn(),
    listTakes: vi.fn(),
    getTake: vi.fn(),
    getPlaybackUrl: vi.fn(),
    deleteTake: vi.fn(),
  },
  uploadMediaToSignedUrl: vi.fn(),
}));

function createWrapper() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return function Wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  };
}

function createInput() {
  return {
    scoreId: 'score-1',
    revisionId: 'revision-1',
    artifactId: 'artifact-1',
    clientRequestId: 'request-1',
    audioBlob: new Blob(['RIFF....WAVE'], { type: 'audio/wav' }),
    mimeType: 'audio/wav',
    durationMs: 1000,
    scopeType: 'FULL',
    scopeStartBeat: 0,
    scopeTerminalBeat: 4,
    tempoSelection: null,
    resolvedTempoPlan: null,
    syncMetadata: null,
  };
}

const savedTake: PerformanceTakeRead = {
  take_id: 'take-1',
  score_id: 'score-1',
  score_title: 'Etude',
  revision_id: 'revision-1',
  artifact_id: 'artifact-1',
  media_kind: 'AUDIO',
  media_mime_type: 'audio/wav',
  media_byte_size: 12,
  duration_ms: 1000,
  scope_type: 'FULL',
  scope_start_beat: 0,
  scope_terminal_beat: 4,
  deletion_status: 'ACTIVE',
  tempo_selection: null,
  resolved_tempo_plan: null,
  sync_metadata: null,
  created_at: '2026-09-21T00:00:00Z',
};

describe('useSavePerformanceTake', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns an archived take without uploading again', async () => {
    vi.mocked(performanceTakesApi.authorizeUpload).mockResolvedValue({
      data: {
        take_id: savedTake.take_id,
        status: 'ARCHIVED',
        upload_headers: {},
        take: savedTake,
      },
    } as never);

    const { result } = renderHook(() => useSavePerformanceTake(), {
      wrapper: createWrapper(),
    });

    let response: PerformanceTakeRead | undefined;
    await act(async () => {
      response = await result.current.mutateAsync(createInput());
    });

    expect(response).toEqual(savedTake);
    expect(uploadMediaToSignedUrl).not.toHaveBeenCalled();
    expect(performanceTakesApi.finalizeTake).not.toHaveBeenCalled();
    expect(performanceTakesApi.cancelUploadAuthorization).not.toHaveBeenCalled();
  });

  it('does not cancel the authorization when finalize result is unknown', async () => {
    vi.mocked(performanceTakesApi.authorizeUpload).mockResolvedValue({
      data: {
        take_id: 'take-1',
        status: 'AUTHORIZED',
        upload_url: '/uploads/staging.wav',
        upload_method: 'PUT',
        upload_headers: {},
        object_key: 'staging/performance-takes/1/take-1/recording.wav',
        reservation_id: 'reservation-1',
        expires_in: 3600,
      },
    } as never);
    vi.mocked(uploadMediaToSignedUrl).mockResolvedValue(undefined);
    vi.mocked(performanceTakesApi.finalizeTake).mockRejectedValue(new Error('network lost'));

    const { result } = renderHook(() => useSavePerformanceTake(), {
      wrapper: createWrapper(),
    });

    await expect(
      act(async () => {
        await result.current.mutateAsync(createInput());
      })
    ).rejects.toThrow('network lost');

    expect(uploadMediaToSignedUrl).toHaveBeenCalledTimes(1);
    expect(performanceTakesApi.cancelUploadAuthorization).not.toHaveBeenCalled();
  });
});
