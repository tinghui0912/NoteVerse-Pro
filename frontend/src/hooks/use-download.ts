'use client';

import { useCallback } from 'react';
import { sharesApi, filesApi, tasksApi } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { useTranslations } from 'next-intl';

interface UseDownloadOptions {
    /** 下载模式：'share' 使用分享 API，'task' 使用任务 API */
    mode: 'share' | 'task';
    /** 标识符：share 模式为 shareToken，task 模式为 taskId */
    id: string;
    /** 图片页数，用于判断是否需要打包下载 */
    imageCount: number;
}

interface UseDownloadReturn {
    /** 下载文件 */
    handleDownload: (type: 'image' | 'xml') => Promise<void>;
}

/**
 * 通用下载 Hook
 * 支持分享页面和结果页面的文件下载
 */
export function useDownload({ mode, id, imageCount }: UseDownloadOptions): UseDownloadReturn {
    const { toast } = useToast();
    const t = useTranslations('download');
    const tErrors = useTranslations('errors');

    const handleDownload = useCallback(async (type: 'image' | 'xml') => {
        try {
            if (type === 'xml') {
                // XML 只有一个文件，直接下载
                const blob = mode === 'share'
                    ? await sharesApi.downloadSharedFile(id, 'final_xml')
                    : await filesApi.downloadFile('final_xml', id);
                filesApi.triggerDownload(blob, `score_${id}.musicxml`);
            } else {
                // 图片：根据页数智能下载
                if (imageCount <= 1) {
                    // 单页：直接下载 PNG
                    const blob = mode === 'share'
                        ? await sharesApi.downloadSharedFile(id, 'final_image')
                        : await filesApi.downloadFile('final_image', id);
                    filesApi.triggerDownload(blob, `score_${id}.png`);
                } else {
                    // 多页：下载 ZIP 包含所有页面
                    if (mode === 'share') {
                        const blob = await sharesApi.downloadSharedArchive(id);
                        filesApi.triggerDownload(blob, `score_${id}.zip`);
                    } else {
                        const result = await tasksApi.archiveTasks([id], ['png']);
                        filesApi.triggerDownload(result.blob, `score_${id}.zip`);
                    }
                }
            }
        } catch (error: any) {
            toast({
                title: t('downloadFailed'),
                description: error.code ? tErrors(error.code as any) : tErrors('UNKNOWN_ERROR'),
                variant: 'destructive',
            });
        }
    }, [mode, id, imageCount, toast, t, tErrors]);

    return { handleDownload };
}
