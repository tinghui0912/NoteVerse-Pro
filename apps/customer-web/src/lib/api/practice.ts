import { apiClient, ApiResponse } from '../api-client';
import type {
    CreatePracticeSessionRequest,
    PracticeReportRead,
    PracticeSessionDetailRead,
    PracticeSessionSummaryRead,
} from '@/generated/practice-api';

export async function createPracticeSession(
    data: CreatePracticeSessionRequest
): Promise<ApiResponse<PracticeSessionSummaryRead>> {
    return apiClient.post<ApiResponse<PracticeSessionSummaryRead>>('/practice/sessions', data);
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

export async function requestPracticeReport(
    sessionId: string
): Promise<ApiResponse<PracticeReportRead>> {
    return apiClient.post<ApiResponse<PracticeReportRead>>(
        `/practice/sessions/${sessionId}/report`
    );
}

export async function getPracticeReport(
    sessionId: string
): Promise<ApiResponse<PracticeReportRead>> {
    return apiClient.get<ApiResponse<PracticeReportRead>>(
        `/practice/sessions/${sessionId}/report`
    );
}

export const practiceApi = {
    createPracticeSession,
    getPracticeSession,
    pausePracticeSession,
    resumePracticeSession,
    finishPracticeSession,
    requestPracticeReport,
    getPracticeReport,
};
