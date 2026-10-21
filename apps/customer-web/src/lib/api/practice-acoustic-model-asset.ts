import { apiClient, type ApiResponse } from '../api-client';
import { ACOUSTIC_MODEL } from '../practice/acoustic/model/model-contract';

export type PracticeAcousticModelAccess = Readonly<{
  schemaVersion: 1; assetId: 'practice-acoustic-robust-browser'; assetVersion: 'v1';
  expectedByteSize: number; sha256: string; mediaType: 'application/octet-stream';
  downloadUrl: string; downloadUrlExpiresAt: string;
}>;
export function assertPracticeAcousticModelAccess(value: unknown): asserts value is PracticeAcousticModelAccess {
  if (!value || typeof value !== 'object') throw new Error('INVALID_PRACTICE_ACOUSTIC_MODEL_ACCESS');
  const data = value as Partial<PracticeAcousticModelAccess>;
  if (data.schemaVersion !== 1 || data.assetId !== 'practice-acoustic-robust-browser' || data.assetVersion !== 'v1'
    || data.expectedByteSize !== ACOUSTIC_MODEL.modelBytes || data.sha256 !== ACOUSTIC_MODEL.modelSha256
    || data.mediaType !== 'application/octet-stream' || typeof data.downloadUrl !== 'string'
    || !data.downloadUrl.startsWith('https://') || !data.downloadUrlExpiresAt
    || !(Date.parse(data.downloadUrlExpiresAt) > Date.now())) throw new Error('PRACTICE_ACOUSTIC_MODEL_ACCESS_IDENTITY_MISMATCH');
}
export async function getPracticeAcousticModelAccess(signal?: AbortSignal): Promise<PracticeAcousticModelAccess> {
  const response = await apiClient.get<ApiResponse<PracticeAcousticModelAccess>>('/model-assets/practice-acoustic-robust-browser-v1/access', undefined,
    { signal, suppressAuthRedirect: true });
  assertPracticeAcousticModelAccess(response.data);
  return Object.freeze({ ...response.data });
}
