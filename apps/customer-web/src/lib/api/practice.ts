import { apiClient, type ApiResponse } from '../api-client';
import type { PracticeSourceRead } from '@/generated/api/types.gen';

async function getPracticeSource(
  scoreId: string,
  revisionId: string,
  includeNotation: boolean,
  signal?: AbortSignal,
): Promise<ApiResponse<PracticeSourceRead>> {
  return apiClient.get<ApiResponse<PracticeSourceRead>>(
    `/practice/scores/${scoreId}/revisions/${revisionId}/source`,
    { include_notation: includeNotation },
    { signal },
  );
}

async function getPracticeSourceById(sourceId: string, includeNotation: boolean, signal?: AbortSignal): Promise<ApiResponse<PracticeSourceRead>> {
  return apiClient.get<ApiResponse<PracticeSourceRead>>(`/practice/sources/${encodeURIComponent(sourceId)}`,
    { include_notation: includeNotation }, { signal });
}

export const practiceApi = { getPracticeSource, getPracticeSourceById };
