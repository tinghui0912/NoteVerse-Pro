'use client';

import { apiClient, ApiResponse } from '../api-client';
import type {
    CreateShareResponse,
    SavedShareListResponse,
    ShareListResponse,
    SharedTaskInfo,
} from '@/types/api';

export async function listShares(
    taskId?: string,
    page: number = 1,
    pageSize: number = 20
): Promise<ApiResponse<ShareListResponse>> {
    return apiClient.get<ApiResponse<ShareListResponse>>('/shares', {
        task_id: taskId,
        page,
        page_size: pageSize,
    });
}

export async function createShare(
    taskId: string,
    expiresInDays: number = 7,
    password?: string
): Promise<ApiResponse<CreateShareResponse>> {
    return apiClient.post<ApiResponse<CreateShareResponse>>('/shares', {
        task_id: taskId,
        expires_in_days: expiresInDays,
        password,
    });
}

export async function deleteShare(shareToken: string): Promise<ApiResponse> {
    return apiClient.delete<ApiResponse>(`/shares/${shareToken}`);
}

export async function revokeShare(shareToken: string): Promise<ApiResponse<{
    share_token: string;
    revoked: boolean;
    revoked_at: string | null;
}>> {
    return apiClient.post<ApiResponse<{
        share_token: string;
        revoked: boolean;
        revoked_at: string | null;
    }>>(`/shares/${shareToken}/revoke`);
}

export async function accessShare(shareToken: string): Promise<ApiResponse<SharedTaskInfo>> {
    return apiClient.get<ApiResponse<SharedTaskInfo>>(`/shares/${shareToken}`);
}

export async function downloadSharedFile(shareToken: string, fileType: string): Promise<Blob> {
    return apiClient.download(`/shares/${shareToken}/download/${fileType}`);
}

export async function downloadSharedArchive(shareToken: string): Promise<Blob> {
    return apiClient.download(`/shares/${shareToken}/download/archive`);
}

export async function saveShareToCollection(token: string): Promise<ApiResponse> {
    return apiClient.post<ApiResponse>('/shares/save', { token });
}

export async function batchDeleteSavedShares(ids: number[]): Promise<ApiResponse<{ deleted_count: number }>> {
    return apiClient.post<ApiResponse<{ deleted_count: number }>>('/shares/saved-shares/batch-delete', {
        ids,
    });
}

export async function listSavedShares(
    page: number = 1,
    pageSize: number = 20,
    sortBy: string = 'created_at',
    sortOrder: string = 'desc',
    search?: string
): Promise<SavedShareListResponse> {
    return apiClient.get<SavedShareListResponse>('/shares/saved-shares', {
        page,
        page_size: pageSize,
        sort_by: sortBy,
        sort_order: sortOrder,
        search,
    });
}

export const sharesApi = {
    listShares,
    createShare,
    deleteShare,
    revokeShare,
    accessShare,
    downloadSharedFile,
    downloadSharedArchive,
    saveShareToCollection,
    batchDeleteSavedShares,
    listSavedShares,
};

export default sharesApi;
