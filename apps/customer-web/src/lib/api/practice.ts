import { apiClient, type ApiResponse } from '../api-client';
import type { PracticeBundleRead } from '@/generated/api/types.gen';

async function getPracticeBundle(
  scoreId: string,
  revisionId: string,
  includeNotation: boolean,
  signal?: AbortSignal,
): Promise<ApiResponse<PracticeBundleRead>> {
  return apiClient.get<ApiResponse<PracticeBundleRead>>(
    `/practice/scores/${scoreId}/revisions/${revisionId}/bundle`,
    { include_notation: includeNotation },
    { signal },
  );
}

export const practiceApi = { getPracticeBundle };
