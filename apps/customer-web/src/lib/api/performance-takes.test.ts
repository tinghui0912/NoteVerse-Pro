import { afterEach, expect, it, vi } from 'vitest';
import { customerFetch } from '../../../tests/helpers/customer-http';
import { performanceTakesApi, type PerformanceTakeUploadReservationRequest } from './performance-takes';
afterEach(() => vi.unstubAllGlobals());
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
