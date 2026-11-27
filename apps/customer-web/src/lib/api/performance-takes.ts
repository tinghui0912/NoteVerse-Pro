import { performanceTakeDelete, performanceTakeGet, performanceTakePlaybackUrlGet, performanceTakeUploadCancel, performanceTakeUploadFinalize, performanceTakeUploadsReserve, performanceTakesList } from '@/generated/api';
import type { PerformanceTakeUploadReservationRequest, PerformanceTakesListData } from '@/generated/api';
import { customerTransport, responseBody, responseComplete } from '@/lib/http/customer-browser-transport';
export type { PerformanceTakeManifestRead, PerformanceTakeRead, PerformanceTakeTempoPlan, PerformanceTakeUploadReservationRead, PerformanceTakeUploadReservationRequest, RecordingTimebase } from '@/generated/api';

export const performanceTakesApi = {
  reserveUpload: (
    request: PerformanceTakeUploadReservationRequest,
    signal?: AbortSignal,
  ) =>
    responseBody(performanceTakeUploadsReserve({ ...customerTransport.authenticated, body: request, signal })),

  cancelUploadReservation: (reservationId: string) =>
    responseComplete(performanceTakeUploadCancel({ ...customerTransport.authenticated, path: { reservation_id: reservationId } })),

  finalizeTake: (reservationId: string, signal?: AbortSignal) =>
    responseBody(performanceTakeUploadFinalize({ ...customerTransport.authenticated, path: { reservation_id: reservationId }, signal })),

  listTakes: (
    params?: PerformanceTakesListData['query'],
    signal?: AbortSignal,
  ) =>
    responseBody(performanceTakesList({ ...customerTransport.authenticated, query: params, signal })),

  getTake: (takeId: string, signal?: AbortSignal) =>
    responseBody(performanceTakeGet({ ...customerTransport.authenticated, path: { take_id: takeId }, signal })),

  getPlaybackUrl: (takeId: string, signal?: AbortSignal) =>
    responseBody(performanceTakePlaybackUrlGet({ ...customerTransport.authenticated, path: { take_id: takeId }, signal })),
  deleteTake: (takeId: string) =>
    responseComplete(performanceTakeDelete({ ...customerTransport.authenticated, path: { take_id: takeId } })),
};
