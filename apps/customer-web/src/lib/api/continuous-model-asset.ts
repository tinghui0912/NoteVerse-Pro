import { apiClient, type ApiResponse } from '../api-client';
import { ACOUSTIC_MODEL } from '../practice/acoustic-inference/continuous/model-contract';

export type ContinuousModelAccess = Readonly<{
  schemaVersion: 1; assetId: 'continuous-robust-browser'; assetVersion: 'v1';
  expectedByteSize: number; sha256: string; mediaType: 'application/octet-stream';
  downloadUrl: string; downloadUrlExpiresAt: string;
}>;
export function assertContinuousModelAccess(value: unknown): asserts value is ContinuousModelAccess {
  if (!value || typeof value !== 'object') throw new Error('INVALID_CONTINUOUS_MODEL_ACCESS');
  const data = value as Partial<ContinuousModelAccess>;
  if (data.schemaVersion !== 1 || data.assetId !== 'continuous-robust-browser' || data.assetVersion !== 'v1'
    || data.expectedByteSize !== ACOUSTIC_MODEL.modelBytes || data.sha256 !== ACOUSTIC_MODEL.modelSha256
    || data.mediaType !== 'application/octet-stream' || typeof data.downloadUrl !== 'string'
    || !data.downloadUrl.startsWith('https://') || !data.downloadUrlExpiresAt
    || !(Date.parse(data.downloadUrlExpiresAt) > Date.now())) throw new Error('CONTINUOUS_MODEL_ACCESS_IDENTITY_MISMATCH');
}
export async function getContinuousModelAccess(signal?: AbortSignal): Promise<ContinuousModelAccess> {
  const response = await apiClient.get<ApiResponse<ContinuousModelAccess>>('/model-assets/continuous-robust-browser-v1/access', undefined,
    { signal, suppressAuthRedirect: true });
  assertContinuousModelAccess(response.data);
  return Object.freeze({ ...response.data });
}
