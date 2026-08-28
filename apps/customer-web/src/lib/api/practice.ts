import { apiClient, ApiResponse } from '../api-client';
import type {
    CreatePracticeSessionRequest,
    PracticeSessionResultSummaryRead,
    PracticeSessionDetailRead,
    PracticeSessionStartRead,
    PracticeReadyScoreContentRead,
    PracticeTargetCatalogRead,
} from '@/generated/practice-api';

export async function createPracticeSession(
    data: CreatePracticeSessionRequest
): Promise<ApiResponse<PracticeSessionStartRead>> {
    return apiClient.post<ApiResponse<PracticeSessionStartRead>>('/practice/sessions', data);
}

export async function getPracticeSession(
    sessionId: string
): Promise<ApiResponse<PracticeSessionDetailRead>> {
    return apiClient.get<ApiResponse<PracticeSessionDetailRead>>(`/practice/sessions/${sessionId}`);
}

export async function pausePracticeSession(
    sessionId: string
): Promise<ApiResponse<PracticeSessionDetailRead>> {
    return apiClient.post<ApiResponse<PracticeSessionDetailRead>>(
        `/practice/sessions/${sessionId}/pause`
    );
}

export async function resumePracticeSession(
    sessionId: string
): Promise<ApiResponse<PracticeSessionDetailRead>> {
    return apiClient.post<ApiResponse<PracticeSessionDetailRead>>(
        `/practice/sessions/${sessionId}/resume`
    );
}

export async function finishPracticeSession(
    sessionId: string
): Promise<ApiResponse<PracticeSessionDetailRead>> {
    return apiClient.post<ApiResponse<PracticeSessionDetailRead>>(
        `/practice/sessions/${sessionId}/finish`
    );
}

export async function getPracticeSessionSummary(
    sessionId: string
): Promise<ApiResponse<PracticeSessionResultSummaryRead>> {
    return apiClient.get<ApiResponse<PracticeSessionResultSummaryRead>>(
        `/practice/sessions/${sessionId}/summary`
    );
}

export async function getPracticeTargets(
    scoreId: string,
    revisionId: string,
    signal?: AbortSignal
): Promise<ApiResponse<PracticeTargetCatalogRead>> {
    return apiClient.get<ApiResponse<PracticeTargetCatalogRead>>(
        `/practice/scores/${scoreId}/revisions/${revisionId}/targets`,
        undefined,
        { signal }
    );
}

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

export const practiceApi = {
    createPracticeSession,
    getPracticeSession,
    pausePracticeSession,
    resumePracticeSession,
    finishPracticeSession,
    getPracticeSessionSummary,
    getPracticeTargets,
    getPracticeReadyScoreContent,
};
