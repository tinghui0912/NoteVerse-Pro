import { apiClient, ApiResponse } from '../api-client';
import type {
    CreatePracticeSessionRequest,
    PracticeReportResponse,
    PracticeSessionDetail,
    PracticeSessionSummary,
} from '@/types/api';

export async function createPracticeSession(
    data: CreatePracticeSessionRequest
): Promise<ApiResponse<PracticeSessionSummary>> {
    return apiClient.post<ApiResponse<PracticeSessionSummary>>('/practice/sessions', data);
}

export async function getPracticeSession(
    sessionId: string
): Promise<ApiResponse<PracticeSessionDetail>> {
    return apiClient.get<ApiResponse<PracticeSessionDetail>>(`/practice/sessions/${sessionId}`);
}

export async function pausePracticeSession(
    sessionId: string
): Promise<ApiResponse<PracticeSessionDetail>> {
    return apiClient.post<ApiResponse<PracticeSessionDetail>>(
        `/practice/sessions/${sessionId}/pause`
    );
}

export async function resumePracticeSession(
    sessionId: string
): Promise<ApiResponse<PracticeSessionDetail>> {
    return apiClient.post<ApiResponse<PracticeSessionDetail>>(
        `/practice/sessions/${sessionId}/resume`
    );
}

export async function finishPracticeSession(
    sessionId: string
): Promise<ApiResponse<PracticeSessionDetail>> {
    return apiClient.post<ApiResponse<PracticeSessionDetail>>(
        `/practice/sessions/${sessionId}/finish`
    );
}

export async function requestPracticeReport(
    sessionId: string
): Promise<ApiResponse<PracticeReportResponse>> {
    return apiClient.post<ApiResponse<PracticeReportResponse>>(
        `/practice/sessions/${sessionId}/report`
    );
}

export async function getPracticeReport(
    sessionId: string
): Promise<ApiResponse<PracticeReportResponse>> {
    return apiClient.get<ApiResponse<PracticeReportResponse>>(
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
