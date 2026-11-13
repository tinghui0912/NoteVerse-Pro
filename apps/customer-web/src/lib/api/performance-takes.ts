import { performanceTakeDelete, performanceTakeGet, performanceTakeMediaStream, performanceTakePlaybackUrlGet, performanceTakeUploadCancel, performanceTakeUploadFinalize, performanceTakeUploadsReserve, performanceTakesList } from '@/generated/api';
import type { PerformanceTakeUploadReservationRequest, PerformanceTakesListData } from '@/generated/api';
import { customerTransport, responseData } from '@/lib/http/customer-browser-transport';
export type { PerformanceTakeManifestRead, PerformanceTakeRead, PerformanceTakeTempoPlan, PerformanceTakeUploadReservationRead, PerformanceTakeUploadReservationRequest, RecordingTimebase } from '@/generated/api';

export const performanceTakesApi = {
  reserveUpload: (
    request: PerformanceTakeUploadReservationRequest,
    signal?: AbortSignal,
  ) =>
    responseData(performanceTakeUploadsReserve({ ...customerTransport.authenticated, body: request, signal })),

  cancelUploadReservation: (reservationId: string) =>
    responseData(performanceTakeUploadCancel({ ...customerTransport.authenticated, path: { reservation_id: reservationId } })),

  finalizeTake: (reservationId: string, signal?: AbortSignal) =>
    responseData(performanceTakeUploadFinalize({ ...customerTransport.authenticated, path: { reservation_id: reservationId }, signal })),

  listTakes: (
    params?: PerformanceTakesListData['query'],
    signal?: AbortSignal,
  ) =>
    responseData(performanceTakesList({ ...customerTransport.authenticated, query: params, signal })),

  getTake: (takeId: string, signal?: AbortSignal) =>
    responseData(performanceTakeGet({ ...customerTransport.authenticated, path: { take_id: takeId }, signal })),

  getPlaybackUrl: (takeId: string, signal?: AbortSignal) =>
    responseData(performanceTakePlaybackUrlGet({ ...customerTransport.authenticated, path: { take_id: takeId }, signal })),
  deleteTake: (takeId: string) =>
    responseData(performanceTakeDelete({ ...customerTransport.authenticated, path: { take_id: takeId } })),
};

/** Authenticated transport only; byte materialization belongs to the consumer. */
export function openPerformanceTakeMedia(
  takeId: string,
  signal?: AbortSignal,
): Promise<Response> {
  return performanceTakeMediaStream({ ...customerTransport.authenticated, path: { take_id: takeId }, signal, parseAs: 'stream' }).then(result => result.response);
}
