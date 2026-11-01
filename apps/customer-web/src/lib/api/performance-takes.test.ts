import { beforeEach, expect, it, vi } from 'vitest';
import { performanceTakesApi, type PerformanceTakeUploadReservationRequest } from './performance-takes';
import { apiClient } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ apiClient: { post: vi.fn(), delete: vi.fn() }, apiUrl: (value: string) => value }));
beforeEach(() => vi.clearAllMocks());

it('reserves one structured immutable save request', () => {
  const request: PerformanceTakeUploadReservationRequest = {
    client_request_id: 'request', source: { source_id: 'source-1' },
    media: { kind: 'AUDIO', byte_size: 10, mime_type: 'audio/webm', duration_ms: 1000 },
    scope: { kind: 'FULL', start_beat: 0, terminal_beat: 4 },
    tempo_plan: { selection: { mode: 'SCORE' }, segments: [{ startBeat: 0, bpm: 120, source: 'MUSICXML' }] },
    recording_timebase: { nominalMediaDurationMs: 1000, activeSegments: [{ perfStartMs: 0, perfEndMs: 1000, mediaStartMs: 0, mediaEndMs: 1000 }] },
  };
  performanceTakesApi.reserveUpload(request);
  expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/performance-takes/upload-reservations', request, { signal: undefined });
});
it('finalizes by public reservation identity with no metadata body', () => {
  performanceTakesApi.finalizeTake('public-upload-uuid');
  expect(apiClient.post).toHaveBeenCalledExactlyOnceWith('/performance-takes/upload-reservations/public-upload-uuid/finalize', undefined, { signal: undefined });
});
it('cancels the public upload reservation', () => {
  performanceTakesApi.cancelUploadReservation('public-upload-uuid');
  expect(apiClient.delete).toHaveBeenCalledExactlyOnceWith('/performance-takes/upload-reservations/public-upload-uuid');
});
