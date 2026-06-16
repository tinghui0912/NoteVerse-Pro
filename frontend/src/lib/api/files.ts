/**
 * 文件相关 API
 */
import { apiClient, ApiResponse } from '../api-client';
import type { FileAccessUrl, UploadedFile, TaskFiles } from '@/types/api';

// ============ API 函数 ============

/**
 * 上传文件
 * @param file 文件对象
 */
export async function uploadFile(file: File): Promise<ApiResponse<UploadedFile>> {
    return apiClient.upload<ApiResponse<UploadedFile>>('/files/upload', file);
}

/**
 * 批量上传文件
 * @param files 文件列表
 * @param onProgress 进度回调
 */
export async function uploadFiles(
    files: File[],
    onProgress?: (current: number, total: number) => void
): Promise<UploadedFile[]> {
    const results: UploadedFile[] = [];

    for (let i = 0; i < files.length; i++) {
        const response = await uploadFile(files[i]);
        if (response.data) {
            results.push(response.data);
        }
        onProgress?.(i + 1, files.length);
    }

    return results;
}

/**
 * 下载文件
 * @param fileType 文件类型
 * @param taskId 任务 ID
 * @param page 页码（可选）
 */
export async function downloadFile(
    fileType: string,
    taskId: string,
    page?: number
): Promise<Blob> {
    const params = page ? `?page=${page}` : '';
    return apiClient.download(`/files/download/${fileType}/${taskId}${params}`);
}

export async function getFileAccessUrl(
    fileType: string,
    taskId: string,
    page?: number,
    shareToken?: string
): Promise<ApiResponse<FileAccessUrl>> {
    const params: Record<string, string | number | undefined> = {
        page,
        share_token: shareToken,
    };
    return apiClient.get<ApiResponse<FileAccessUrl>>(
        `/files/access-url/${fileType}/${taskId}`,
        params
    );
}

/**
 * 获取任务的所有文件
 * @param taskId 任务 ID
 */
export async function getTaskFiles(taskId: string): Promise<ApiResponse<TaskFiles>> {
    return apiClient.get<ApiResponse<TaskFiles>>(`/files/tasks/${taskId}`);
}

/**
 * 预览文件
 * @param filename 文件名
 */
export function getPreviewUrl(filename: string): string {
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
    return `${baseUrl}/files/preview/${filename}`;
}

/**
 * 删除文件
 * @param filename 文件名
 */
export async function deleteFile(filename: string): Promise<ApiResponse> {
    return apiClient.delete<ApiResponse>(`/files/${filename}`);
}

/**
 * 导出任务到 Excel
 * @param taskIds 任务 ID 列表
 */
export async function exportExcel(taskIds: string[]): Promise<Blob> {
    const response = await apiClient.postDownload('/files/export/excel', {
        task_ids: taskIds,
    });

    return response.blob();
}

/**
 * 触发文件下载
 * @param blob 文件 Blob
 * @param filename 文件名
 */
export function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

export const filesApi = {
    uploadFile,
    uploadFiles,
    downloadFile,
    getFileAccessUrl,
    getTaskFiles,
    getPreviewUrl,
    deleteFile,
    exportExcel,
    triggerDownload,
};

export default filesApi;
