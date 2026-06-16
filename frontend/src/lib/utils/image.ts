'use client';

import { filesApi } from '@/lib/api/files';
import { sharesApi } from '@/lib/api/shares';

export async function fetchAuthenticatedImage(
    taskId: string,
    fileType: string,
    page: number = 1,
    shareToken?: string,
    version?: string
): Promise<string | null> {
    try {
        const response = await filesApi.getFileAccessUrl(fileType, taskId, page, shareToken);
        if (!response.data?.url) {
            return null;
        }
        if (version && response.data.url.startsWith('/')) {
            const cacheSeparator = response.data.url.includes('?') ? '&' : '?';
            return `${response.data.url}${cacheSeparator}v=${encodeURIComponent(version)}`;
        }
        return response.data.url;
    } catch {
        return null;
    }
}

export async function fetchMultipleImages(
    items: Array<{ taskId: string; fileType: string }>
): Promise<Map<string, string>> {
    const results = new Map<string, string>();

    await Promise.all(
        items.map(async ({ taskId, fileType }) => {
            const url = await fetchAuthenticatedImage(taskId, fileType);
            if (url) {
                results.set(taskId, url);
            }
        })
    );

    return results;
}

export async function fetchSharedImage(
    shareToken: string,
    page: number,
    fileType: string = 'final_image'
): Promise<string | null> {
    try {
        const response = await sharesApi.getSharedFileAccessUrl(shareToken, fileType, page);
        return response.data?.url ?? null;
    } catch (error) {
        console.error('Failed to fetch shared image:', error);
        return null;
    }
}
