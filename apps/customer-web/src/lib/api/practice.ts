import { apiClient, ApiResponse } from '../api-client';
import type { PracticeSourceContentRead, PracticeSourceArtifactRead } from '@/generated/api/types.gen';

async function getPracticeReadyScoreContent(
    scoreId: string,
    revisionId: string,
    signal?: AbortSignal
): Promise<ApiResponse<PracticeSourceContentRead>> {
    return apiClient.get<ApiResponse<PracticeSourceContentRead>>(
        `/practice/scores/${scoreId}/revisions/${revisionId}/source/content`,
        undefined,
        { signal }
    );
}

async function getPracticeScoreArtifact(
    scoreId: string,
    revisionId: string,
    signal?: AbortSignal
): Promise<ApiResponse<PracticeSourceArtifactRead>> {
    return apiClient.get<ApiResponse<PracticeSourceArtifactRead>>(
        `/practice/scores/${scoreId}/revisions/${revisionId}/source/artifact`,
        undefined,
        { signal }
    );
}

export const practiceApi = {
    getPracticeReadyScoreContent,
    getPracticeScoreArtifact,
};
