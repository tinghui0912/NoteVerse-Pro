'use client';

import { useCallback } from 'react';
import { filesApi, scoresApi, scoreSharingApi } from '@/lib/api';
import type { ScoreArtifact } from '@/types/api';
import { useToast } from '@/hooks/use-toast';
import { useTranslations } from 'next-intl';

interface UseDownloadOptions {
    /** 涓嬭浇妯″紡锛?share' 浣跨敤鍒嗕韩 API锛?task' 浣跨敤浠诲姟 API */
    mode: 'score' | 'grant';
    /** 鏍囪瘑绗︼細share 妯″紡涓?shareToken锛宼ask 妯″紡涓?taskId */
    id: string;
    /** 鍥剧墖椤垫暟锛岀敤浜庡垽鏂槸鍚﹂渶瑕佹墦鍖呬笅杞?*/
    imageCount?: number;
    artifacts?: ScoreArtifact[];
}

interface UseDownloadReturn {
    /** 涓嬭浇鏂囦欢 */
    handleDownload: (type: 'image' | 'xml') => Promise<void>;
}

function extensionFromBlob(blob: Blob): string {
    const mimeExtensions: Record<string, string> = {
        'image/png': 'png',
        'image/svg+xml': 'svg',
        'application/pdf': 'pdf',
    };

    return mimeExtensions[blob.type] ?? 'bin';
}

/**
 * 閫氱敤涓嬭浇 Hook
 * 鏀寔鍒嗕韩椤甸潰鍜岀粨鏋滈〉闈㈢殑鏂囦欢涓嬭浇
 */
export function useDownload({ mode, id, artifacts = [] }: UseDownloadOptions): UseDownloadReturn {
    const { toast } = useToast();
    const t = useTranslations('download');
    const tErrors = useTranslations('errors');

    const handleDownload = useCallback(async (type: 'image' | 'xml') => {
        try {
            if (type === 'xml') {
                if (mode === 'grant') {
                    const artifact = artifacts.find((item) => item.kind === 'MUSICXML');
                    if (!artifact) throw new Error('FILE_NOT_FOUND');
                    const blob = await scoreSharingApi.downloadArtifact(id, artifact.artifact_id);
                    filesApi.triggerDownload(blob, `score_${artifact.revision_id}.musicxml`);
                    return;
                }
                if (mode === 'score') {
                    const artifact = artifacts.find((item) => item.kind === 'MUSICXML');
                    if (!artifact) throw new Error('FILE_NOT_FOUND');
                    const blob = await scoresApi.downloadArtifact(artifact.artifact_id);
                    filesApi.triggerDownload(blob, `score_${id}.musicxml`);
                    return;
                }
                // XML 鍙湁涓€涓枃浠讹紝鐩存帴涓嬭浇
            } else {
                if (mode === 'grant') {
                    const pages = artifacts.filter((item) => item.kind === 'RENDERED_PAGE');
                    if (!pages.length) throw new Error('FILE_NOT_FOUND');
                    for (const page of pages) {
                        const blob = await scoreSharingApi.downloadArtifact(id, page.artifact_id);
                        filesApi.triggerDownload(blob, page.filename);
                    }
                    return;
                }
                if (mode === 'score') {
                    const pages = artifacts.filter((item) => item.kind === 'RENDERED_PAGE');
                    if (!pages.length) throw new Error('FILE_NOT_FOUND');
                    const blob = pages.length === 1
                        ? await scoresApi.downloadArtifact(pages[0].artifact_id)
                        : await scoresApi.downloadArtifactArchive(id, pages[0].revision_id, 'RENDERED_PAGE');
                    filesApi.triggerDownload(
                        blob,
                        pages.length === 1 ? `score_${id}.${extensionFromBlob(blob)}` : `score_${id}.zip`
                    );
                    return;
                }
                // 鍥剧墖锛氭牴鎹〉鏁版櫤鑳戒笅杞?
            }
        } catch (error: unknown) {
            const errorCode = typeof error === 'object' && error !== null && 'code' in error
                ? String(error.code)
                : null;
            toast({
                title: t('downloadFailed'),
                description: errorCode ? tErrors(errorCode as never) : tErrors('UNKNOWN_ERROR'),
                variant: 'destructive',
            });
        }
    }, [mode, id, artifacts, toast, t, tErrors]);

    return { handleDownload };
}
