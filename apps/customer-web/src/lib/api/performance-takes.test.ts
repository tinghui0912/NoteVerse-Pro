import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { performanceTakesApi, uploadMediaToSignedUrl, type PerformanceTakeUploadReservationRequest } from './performance-takes';
import { apiClient } from '@/lib/api-client';

vi.mock('@/lib/api-client', () => ({ apiClient: { post: vi.fn(), delete: vi.fn() }, apiUrl: (value: string) => value }));
beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

it('sends raw MP4 capture as the signed PUT body without rebuilding its Blob', async () => {
  const blob = new Blob(['raw MP4 capture'], { type: 'video/mp4' });
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(null, { status: 200 }));
  vi.stubGlobal('fetch', fetch);
  await uploadMediaToSignedUrl('https://storage.example/capture.mp4', 'PUT', { 'content-type': 'video/mp4' }, blob);
  expect(fetch).toHaveBeenCalledExactlyOnceWith('https://storage.example/capture.mp4', {
    method: 'PUT', headers: { 'content-type': 'video/mp4' }, body: blob,
  });
  expect(fetch.mock.calls[0][1]?.body).toBe(blob);
});

it('reserves one structured immutable save request', () => {
  const request: PerformanceTakeUploadReservationRequest = {
    client_request_id: 'request', practice_binding: { score_id:'score-1',revision_id:'revision-1',bundle_id:'source-1' },
    media: { kind: 'AUDIO', byte_size: 10, mime_type: 'audio/webm' },
    scope: { kind: 'FULL' },
    tempo_selection: { mode: 'SCORE' },
    recording_timebase: { nominalMediaDurationUs: 1000000, activeSegments: [{ performanceStartUs: 0, performanceEndUs: 1000000, mediaStartUs: 0, mediaEndUs: 1000000 }] },
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
