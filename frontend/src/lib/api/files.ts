import { apiClient, ApiResponse } from '../api-client';
import type { UploadedFile } from '@/types/api';

export async function uploadFile(file: File): Promise<ApiResponse<UploadedFile>> {
    return apiClient.upload<ApiResponse<UploadedFile>>('/files/upload', file);
}

export async function uploadFiles(
    files: File[],
    onProgress?: (current: number, total: number) => void
): Promise<UploadedFile[]> {
    const results: UploadedFile[] = [];
    for (let index = 0; index < files.length; index += 1) {
        const response = await uploadFile(files[index]);
        if (response.data) results.push(response.data);
        onProgress?.(index + 1, files.length);
    }
    return results;
}

export async function deleteFile(filename: string): Promise<ApiResponse> {
    return apiClient.delete<ApiResponse>(`/files/${filename}`);
}

export function triggerDownload(blob: Blob, filename: string): void {
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
}

export const filesApi = { uploadFile, uploadFiles, deleteFile, triggerDownload };
