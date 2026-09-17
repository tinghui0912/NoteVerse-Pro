import { apiClient, ApiResponse } from '../api-client';
import type {
    CreatePracticeSessionRequest,
    PracticeSessionResultSummaryRead,
    PracticeSessionDetailRead,
    PracticeSessionStartRead,
    PracticeReadyScoreContentRead,
    PracticeReplayFinalizeRequest,
    PracticeReplayUploadAuthorizationRead,
    PracticeReplayUploadAuthorizationRequest,
    SavedPracticePerformanceRead,
    SavedPracticeReplayPlaybackRead,
    SavedPracticeReplayArtifactRead,
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

export async function listPracticeReplayArtifacts(
    sessionId: string
): Promise<ApiResponse<SavedPracticeReplayArtifactRead[]>> {
    return apiClient.get<ApiResponse<SavedPracticeReplayArtifactRead[]>>(
        `/practice/sessions/${sessionId}/replay-artifacts`
    );
}

export async function listSavedPracticePerformances(
    scoreId: string,
    signal?: AbortSignal
): Promise<ApiResponse<SavedPracticePerformanceRead[]>> {
    return apiClient.get<ApiResponse<SavedPracticePerformanceRead[]>>(
        `/practice/scores/${scoreId}/saved-performances`,
        undefined,
        { signal }
    );
}

export async function authorizePracticeReplayUpload(
    sessionId: string,
    request: PracticeReplayUploadAuthorizationRequest
): Promise<ApiResponse<PracticeReplayUploadAuthorizationRead>> {
    return apiClient.post<ApiResponse<PracticeReplayUploadAuthorizationRead>>(
        `/practice/sessions/${sessionId}/replay-upload-authorizations`,
        request
    );
}

export async function uploadPracticeReplayObject(
    uploadUrl: string,
    file: Blob,
    headers: Record<string, string>
): Promise<void> {
    return apiClient.putBlobToUrl(uploadUrl, file, headers);
}

export async function finalizePracticeReplayArtifact(
    sessionId: string,
    request: PracticeReplayFinalizeRequest
): Promise<ApiResponse<SavedPracticeReplayArtifactRead>> {
    return apiClient.post<ApiResponse<SavedPracticeReplayArtifactRead>>(
        `/practice/sessions/${sessionId}/replay-artifacts`,
        request
    );
}

export async function getPracticeReplayArtifactPlaybackUrl(
    sessionId: string,
    artifactId: string
): Promise<ApiResponse<SavedPracticeReplayPlaybackRead>> {
    return apiClient.get<ApiResponse<SavedPracticeReplayPlaybackRead>>(
        `/practice/sessions/${sessionId}/replay-artifacts/${artifactId}/playback-url`
    );
}

export async function deletePracticeReplayArtifact(
    sessionId: string,
    artifactId: string
): Promise<ApiResponse<SavedPracticeReplayArtifactRead>> {
    return apiClient.delete<ApiResponse<SavedPracticeReplayArtifactRead>>(
        `/practice/sessions/${sessionId}/replay-artifacts/${artifactId}`
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
    listPracticeReplayArtifacts,
    listSavedPracticePerformances,
    authorizePracticeReplayUpload,
    uploadPracticeReplayObject,
    finalizePracticeReplayArtifact,
    getPracticeReplayArtifactPlaybackUrl,
    deletePracticeReplayArtifact,
    getPracticeTargets,
    getPracticeReadyScoreContent,
};
