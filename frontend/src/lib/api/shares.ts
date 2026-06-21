'use client';

import { apiClient, ApiResponse } from '../api-client';
import type {
    CreateShareResponse,
    CreateShareRequest,
    FileAccessUrl,
    SavedShareListResponse,
    ShareListResponse,
    SharedTaskInfo,
} from '@/types/api';

export async function listShares(
    taskId?: string,
    page: number = 1,
    pageSize: number = 20,
    signal?: AbortSignal
): Promise<ApiResponse<ShareListResponse>> {
    return apiClient.get<ApiResponse<ShareListResponse>>('/shares', {
        task_id: taskId,
        page,
        page_size: pageSize,
    }, { signal });
}

export async function createShare(
    taskId: string,
    options: CreateShareRequest
): Promise<ApiResponse<CreateShareResponse>> {
    return apiClient.post<ApiResponse<CreateShareResponse>>('/shares', {
        task_id: taskId,
        ...options,
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

export async function accessShare(
    shareToken: string,
    signal?: AbortSignal
): Promise<ApiResponse<SharedTaskInfo>> {
    return apiClient.get<ApiResponse<SharedTaskInfo>>(`/shares/${shareToken}`, undefined, { signal });
}

export async function downloadSharedFile(
    shareToken: string,
    fileType: string,
    signal?: AbortSignal
): Promise<Blob> {
    return apiClient.download(`/shares/${shareToken}/download/${fileType}`, { signal });
}

export async function getSharedFileAccessUrl(
    shareToken: string,
    fileType: string,
    page?: number,
    signal?: AbortSignal
): Promise<ApiResponse<FileAccessUrl>> {
    return apiClient.get<ApiResponse<FileAccessUrl>>(
        `/shares/${shareToken}/access-url/${fileType}`,
        { page },
        { signal }
    );
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
    search?: string,
    signal?: AbortSignal
): Promise<SavedShareListResponse> {
    return apiClient.get<SavedShareListResponse>('/shares/saved-shares', {
        page,
        page_size: pageSize,
        sort_by: sortBy,
        sort_order: sortOrder,
        search,
    }, { signal });
}

export const sharesApi = {
    listShares,
    createShare,
    deleteShare,
    revokeShare,
    accessShare,
    downloadSharedFile,
    getSharedFileAccessUrl,
    downloadSharedArchive,
    saveShareToCollection,
    batchDeleteSavedShares,
    listSavedShares,
};

export default sharesApi;
