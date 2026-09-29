import { apiClient, ApiResponse } from '../api-client';
import type { PracticeScoreArtifact } from '../practice/local-core/artifact';

export type PracticeReadyScoreContentRead = {
    score_id: string;
    revision_id: string;
    content: string;
    mime_type?: string;
};

export async function getPracticeReadyScoreContent(
    scoreId: string,
    revisionId: string,
    signal?: AbortSignal
): Promise<ApiResponse<PracticeReadyScoreContentRead>> {
    return apiClient.get<ApiResponse<PracticeReadyScoreContentRead>>(
        `/practice/scores/${scoreId}/revisions/${revisionId}/content`,
        undefined,
        { signal }
    );
}

export async function getPracticeScoreArtifact(
    scoreId: string,
    revisionId: string,
    signal?: AbortSignal
): Promise<ApiResponse<PracticeScoreArtifact>> {
    return apiClient.get<ApiResponse<PracticeScoreArtifact>>(
        `/practice/scores/${scoreId}/revisions/${revisionId}/artifact`,
        undefined,
        { signal }
    );
}

export const practiceApi = {
    getPracticeReadyScoreContent,
    getPracticeScoreArtifact,
};
