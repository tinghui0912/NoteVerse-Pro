import { apiClient, ApiResponse } from '../api-client';
import type {
    PracticeSessionResultSummaryRead,
    PracticeSessionDetailRead,
    PracticeReplayFinalizeRequest,
    PracticeReplayUploadAuthorizationRead,
    PracticeReplayUploadAuthorizationRequest,
    SavedPracticePerformanceRead,
    SavedPracticeReplayPlaybackRead,
    SavedPracticeReplayArtifactRead,
} from '@/generated/practice-api';

export async function getPracticeSession(
    sessionId: string
): Promise<ApiResponse<PracticeSessionDetailRead>> {
    return apiClient.get<ApiResponse<PracticeSessionDetailRead>>(`/practice/sessions/${sessionId}`);
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

export const practiceHistoryApi = {
    getPracticeSession,
    getPracticeSessionSummary,
    listPracticeReplayArtifacts,
    listSavedPracticePerformances,
    authorizePracticeReplayUpload,
    uploadPracticeReplayObject,
    finalizePracticeReplayArtifact,
    getPracticeReplayArtifactPlaybackUrl,
    deletePracticeReplayArtifact,
};
