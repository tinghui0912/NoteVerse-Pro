'use client';

import { useCallback } from 'react';
import { sharesApi, filesApi, tasksApi } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useTranslations } from 'next-intl';

interface UseDownloadOptions {
    /** 涓嬭浇妯″紡锛?share' 浣跨敤鍒嗕韩 API锛?task' 浣跨敤浠诲姟 API */
    mode: 'share' | 'task';
    /** 鏍囪瘑绗︼細share 妯″紡涓?shareToken锛宼ask 妯″紡涓?taskId */
    id: string;
    /** 鍥剧墖椤垫暟锛岀敤浜庡垽鏂槸鍚﹂渶瑕佹墦鍖呬笅杞?*/
    imageCount: number;
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
export function useDownload({ mode, id, imageCount }: UseDownloadOptions): UseDownloadReturn {
    const { toast } = useToast();
    const t = useTranslations('download');
    const tErrors = useTranslations('errors');

    const handleDownload = useCallback(async (type: 'image' | 'xml') => {
        try {
            if (type === 'xml') {
                // XML 鍙湁涓€涓枃浠讹紝鐩存帴涓嬭浇
                const blob = mode === 'share'
                    ? await sharesApi.downloadSharedFile(id, 'final_xml')
                    : await filesApi.downloadFile('final_xml', id);
                filesApi.triggerDownload(blob, `score_${id}.musicxml`);
            } else {
                // 鍥剧墖锛氭牴鎹〉鏁版櫤鑳戒笅杞?
                if (imageCount <= 1) {
                    // 鍗曢〉锛氱洿鎺ヤ笅杞?PNG
                    const blob = mode === 'share'
                        ? await sharesApi.downloadSharedFile(id, 'final_image')
                        : await filesApi.downloadFile('final_image', id);
                    filesApi.triggerDownload(blob, `score_${id}.${extensionFromBlob(blob)}`);
                } else {
                    // 澶氶〉锛氫笅杞?ZIP 鍖呭惈鎵€鏈夐〉闈?
                    if (mode === 'share') {
                        const blob = await sharesApi.downloadSharedArchive(id);
                        filesApi.triggerDownload(blob, `score_${id}.zip`);
                    } else {
                        const result = await tasksApi.archiveTasks([id], ['image']);
                        filesApi.triggerDownload(result.blob, `score_${id}.zip`);
                    }
                }
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
    }, [mode, id, imageCount, toast, t, tErrors]);

    return { handleDownload };
}
