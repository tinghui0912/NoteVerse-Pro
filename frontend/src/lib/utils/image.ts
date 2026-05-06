'use client';

import { getToken } from '@/lib/api-client';

export async function fetchAuthenticatedImage(
    taskId: string,
    fileType: string,
    page: number = 1,
    shareToken?: string
): Promise<string | null> {
    const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
    let url = `${baseUrl}/files/download/${fileType}/${taskId}?page=${page}`;

    if (shareToken) {
        url += `&share_token=${encodeURIComponent(shareToken)}`;
    }

    try {
        const token = getToken() || '';
        const response = await fetch(url, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            return null;
        }

        const blob = await response.blob();
        return URL.createObjectURL(blob);
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

export function revokeImageUrls(urls: string[]): void {
    urls.forEach(url => {
        if (url.startsWith('blob:')) {
            URL.revokeObjectURL(url);
        }
    });
}

export async function fetchSharedImageAsBlob(
    shareToken: string,
    page: number,
    fileType: string = 'final_image'
): Promise<string | null> {
    try {
        const baseUrl = process.env.NEXT_PUBLIC_API_BASE_URL || '/api/v1';
        const token = getToken() || '';
        const response = await fetch(`${baseUrl}/shares/${shareToken}/download/${fileType}?page=${page}`, {
            headers: {
                Authorization: `Bearer ${token}`,
            },
        });

        if (!response.ok) {
            return null;
        }

        const blob = await response.blob();
        return URL.createObjectURL(blob);
    } catch (error) {
        console.error('Failed to fetch shared image:', error);
        return null;
    }
}
