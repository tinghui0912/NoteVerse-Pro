// @vitest-environment jsdom

import React, { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  performanceTakesApi,
  uploadMediaToSignedUrl,
  type PerformanceTakeRead,
  type PerformanceTakeUploadReservationRead,
  type RecordingTimebase,
  type PerformanceTakeTempoPlan,
} from '@/lib/api/performance-takes';
import { useSavePerformanceTake } from '@/hooks/queries/use-performance-take-queries';

vi.mock('@/lib/api/performance-takes', () => ({
  performanceTakesApi: {
    reserveUpload: vi.fn(),
    cancelUploadReservation: vi.fn(),
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

const tempoPlan: PerformanceTakeTempoPlan = {
  selection: { mode: 'SCORE' },
  segments: [{ startBeat: 0, bpm: 120, source: 'MUSICXML' }],
};

const recordingTimebase: RecordingTimebase = {
  nominalMediaDurationMs: 1000,
  activeSegments: [
    { perfStartMs: 0, perfEndMs: 1000, mediaStartMs: 0, mediaEndMs: 1000 },
  ],
};

function createInput() {
  return {
    sourceId: 'source-1',
    clientRequestId: 'request-1',
    mediaKind: 'AUDIO' as const,
    mediaBlob: new Blob(['RIFF....WAVE'], { type: 'audio/wav' }),
    mimeType: 'audio/wav',
    durationMs: 1000,
    scope: {
      kind: 'FULL' as const,
      startBeat: 0,
      terminalBeat: 4,
    },
    tempoPlan,
    recordingTimebase,
  };
}

const savedTake: PerformanceTakeRead = {
  take_id: 'take-1',
  source_id: 'source-1',
  source_score_id: 'score-1',
  score_title_snapshot: 'Etude',
  source_revision_id: 'revision-1',
  source_artifact_id: 'artifact-1',
  media_kind: 'AUDIO',
  media_mime_type: 'audio/wav',
  media_byte_size: 12,
  duration_ms: 1000,
  scope_type: 'FULL',
  scope_start_beat: 0,
  scope_terminal_beat: 4,
  deletion_status: 'ACTIVE',
  tempo_plan: tempoPlan,
  recording_timebase: recordingTimebase,
  created_at: '2026-09-21T00:00:00Z',
};


function reservation(status: PerformanceTakeUploadReservationRead['status'] = 'RESERVED'): PerformanceTakeUploadReservationRead {
  const input = createInput();
  return {
    reservation_id: 'upload-reservation-1', take_id: savedTake.take_id, status,
    metadata: {
      source: { source_id: 'source-1' },
      media: { kind: input.mediaKind, byte_size: input.mediaBlob.size, mime_type: input.mimeType, duration_ms: input.durationMs },
      scope: { kind: 'FULL', start_beat: 0, terminal_beat: 4 }, tempo_plan: tempoPlan, recording_timebase: recordingTimebase,
    },
    upload_target: status === 'RESERVED' ? { url: '/uploads/staging.wav', method: 'PUT', headers: { 'content-type': 'audio/wav' }, expires_in: 3600 } : null,
    take: status === 'COMPLETED' ? savedTake : null,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({ data: reservation() } as never);
  vi.mocked(uploadMediaToSignedUrl).mockResolvedValue();
  vi.mocked(performanceTakesApi.finalizeTake).mockResolvedValue({ data: savedTake } as never);
});

async function save() {
  const { result } = renderHook(() => useSavePerformanceTake(), { wrapper: createWrapper() });
  let response;
  await act(async () => { response = await result.current.mutateAsync(createInput()); });
  return response;
}

describe('useSavePerformanceTake', () => {
  it('sends metadata once to reserve, uploads to the target, and finalizes only its public identity', async () => {
    expect(await save()).toEqual(savedTake);
    expect(performanceTakesApi.reserveUpload).toHaveBeenCalledExactlyOnceWith({ client_request_id: 'request-1', ...reservation().metadata });
    expect(uploadMediaToSignedUrl).toHaveBeenCalledExactlyOnceWith('/uploads/staging.wav', 'PUT', { 'content-type': 'audio/wav' }, createInput().mediaBlob);
    expect(performanceTakesApi.finalizeTake).toHaveBeenCalledExactlyOnceWith('upload-reservation-1');
    expect(performanceTakesApi.cancelUploadReservation).not.toHaveBeenCalled();
  });
  it('returns COMPLETED without another upload or finalize', async () => {
    vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({ data: reservation('COMPLETED') } as never);
    expect(await save()).toEqual(savedTake);
    expect(uploadMediaToSignedUrl).not.toHaveBeenCalled(); expect(performanceTakesApi.finalizeTake).not.toHaveBeenCalled();
  });
  it('retries FINALIZING by identity without uploading', async () => {
    vi.mocked(performanceTakesApi.reserveUpload).mockResolvedValue({ data: reservation('FINALIZING') } as never);
    expect(await save()).toEqual(savedTake); expect(uploadMediaToSignedUrl).not.toHaveBeenCalled();
    expect(performanceTakesApi.finalizeTake).toHaveBeenCalledExactlyOnceWith('upload-reservation-1');
  });
  it('cancels the public reservation after a failed binary upload', async () => {
    vi.mocked(uploadMediaToSignedUrl).mockRejectedValue(new Error('upload failed'));
    await expect(save()).rejects.toThrow('upload failed');
    expect(performanceTakesApi.cancelUploadReservation).toHaveBeenCalledExactlyOnceWith('upload-reservation-1');
    expect(performanceTakesApi.finalizeTake).not.toHaveBeenCalled();
  });
  it.each([new Error('network lost'), { response: { status: 422 } }])('retains reservation on unknown/recoverable finalize outcome', async error => {
    vi.mocked(performanceTakesApi.finalizeTake).mockRejectedValue(error);
    await expect(save()).rejects.toBe(error); expect(uploadMediaToSignedUrl).toHaveBeenCalledOnce();
    expect(performanceTakesApi.cancelUploadReservation).not.toHaveBeenCalled();
  });
  it('reserves RANGE VIDEO metadata once', async () => {
    const input = { ...createInput(), mediaKind: 'VIDEO' as const, scope: { kind: 'RANGE' as const, startBeat: 1, terminalBeat: 3, startGroupId: 'g1', endGroupId: 'g3' } };
    const { result } = renderHook(() => useSavePerformanceTake(), { wrapper: createWrapper() });
    await act(async () => { await result.current.mutateAsync(input); });
    expect(performanceTakesApi.reserveUpload).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      media: expect.objectContaining({ kind: 'VIDEO' }), scope: { kind: 'RANGE', start_beat: 1, terminal_beat: 3, start_group_id: 'g1', end_group_id: 'g3' },
    }));
    expect(performanceTakesApi.finalizeTake).toHaveBeenCalledExactlyOnceWith('upload-reservation-1');
  });
});
