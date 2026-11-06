import { apiClient, type ApiResponse } from '../api-client';
import type { PracticeAcousticAccessRead } from '@/generated/api/types.gen';
import { ACOUSTIC_MODEL_ASSET_DESCRIPTOR } from '../practice/acoustic/generated/runtime-contract';

export function assertPracticeAcousticModelAccess(value: unknown): asserts value is PracticeAcousticAccessRead {
  if (!value || typeof value !== 'object') throw new Error('INVALID_PRACTICE_ACOUSTIC_MODEL_ACCESS');
  const data = value as Partial<PracticeAcousticAccessRead>;
  if(Object.entries(ACOUSTIC_MODEL_ASSET_DESCRIPTOR).some(([key, expected]) => data[key as keyof PracticeAcousticAccessRead] !== expected)
    || typeof data.downloadUrl !== 'string' || !data.downloadUrl.startsWith('https://')
    || typeof data.downloadUrlExpiresAt !== 'string' || !(Date.parse(data.downloadUrlExpiresAt) > Date.now())) {
    throw new Error('PRACTICE_ACOUSTIC_MODEL_ACCESS_IDENTITY_MISMATCH');
  }
}
export async function getPracticeAcousticModelAccess(signal?: AbortSignal): Promise<PracticeAcousticAccessRead> {
  const response = await apiClient.get<ApiResponse<PracticeAcousticAccessRead>>('/model-assets/practice-acoustic/access', undefined,
    { signal, suppressAuthRedirect: true });
  assertPracticeAcousticModelAccess(response.data);
  return Object.freeze({ ...response.data });
}
