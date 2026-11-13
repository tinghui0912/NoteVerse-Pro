import { uploadMediaToSignedUrl } from '@/lib/http/direct-object-upload';
import { afterEach, expect, it, vi } from 'vitest';
import { customerFetch } from '../../../tests/helpers/customer-http';
import { performanceTakesApi, type PerformanceTakeUploadReservationRequest } from './performance-takes';
afterEach(() => vi.unstubAllGlobals());
it('sends opaque signed PUT targets and required headers without Customer credentials', async () => {
  const blob = new Blob(['raw MP4'], { type: 'video/mp4' });
  const send = vi.fn<typeof fetch>(async () => new Response());
  vi.stubGlobal('fetch', send);
  const headers = { 'content-type': 'video/mp4' };
  await uploadMediaToSignedUrl('https://storage.example/capture.mp4', 'PUT', headers, blob);
  expect(send).toHaveBeenCalledExactlyOnceWith('https://storage.example/capture.mp4', {
    method: 'PUT', headers, body: blob, credentials: 'omit',
  });
});
it('reserves the immutable request using the generated JSON operation', async () => {
  const send = customerFetch();
  const request: PerformanceTakeUploadReservationRequest = {
    client_request_id: 'request', practice_binding: { score_id: 'score-1', revision_id: 'revision-1', bundle_id: 'source-1' },
    media: { kind: 'AUDIO', byte_size: 10, mime_type: 'audio/webm' },
    scope: { kind: 'FULL' },
    tempo_selection: { mode: 'SCORE' },
    recording_timebase: { nominalMediaDurationUs: 1000000, activeSegments: [{ performanceStartUs: 0, performanceEndUs: 1000000, mediaStartUs: 0, mediaEndUs: 1000000 }] },
  };
  await performanceTakesApi.reserveUpload(request);
  expect(await (send.mock.calls[0][0] as Request).json()).toEqual(request);
});
it('finalizes and cancels by public reservation identity', async () => {
  const send = customerFetch();
  await performanceTakesApi.finalizeTake('reservation');
  expect((send.mock.calls[0][0] as Request).method).toBe('POST');
  expect(new URL((send.mock.calls[0][0] as Request).url).pathname).toBe('/api/v1/performance-takes/upload-reservations/reservation/finalize');
  await performanceTakesApi.cancelUploadReservation('reservation');
  expect((send.mock.calls[1][0] as Request).method).toBe('DELETE');
});

it.each(['relative-target', 'http-failure', 'network-failure'])('reports explicit signed upload failure for %s', async failure => {
  const send = vi.fn<typeof fetch>(async () => {
    if (failure === 'network-failure') throw new TypeError('offline');
    return new Response(null, { status: 503 });
  });
  vi.stubGlobal('fetch', send);
  await expect(uploadMediaToSignedUrl(failure === 'relative-target' ? '/upload' : 'https://storage.test/object', 'PUT', {}, new Blob(['bytes'])))
    .rejects.toMatchObject({ code: 'direct_upload_failed' });
  expect(send).toHaveBeenCalledTimes(failure === 'relative-target' ? 0 : 1);
});
