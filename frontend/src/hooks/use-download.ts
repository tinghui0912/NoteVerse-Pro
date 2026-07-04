'use client';

import { useCallback } from 'react';
import { filesApi, scoresApi, scoreSharingApi } from '@/lib/api';
import type { ScoreArtifact } from '@/types/api';
import { useToast } from '@/hooks/use-toast';
import { useTranslations } from 'next-intl';
import { translateErrorCode } from '@/lib/i18n/error-message';

interface UseDownloadOptions {
    mode: 'score' | 'grant';
    id: string;
    artifacts?: ScoreArtifact[];
}

interface UseDownloadReturn {
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
            }
        } catch (error: unknown) {
            const errorCode = typeof error === 'object' && error !== null && 'code' in error
                ? String(error.code)
                : null;
            toast({
                title: t('downloadFailed'),
                description: translateErrorCode(tErrors, errorCode, t('downloadFailedDesc')),
                variant: 'destructive',
            });
        }
    }, [mode, id, artifacts, toast, t, tErrors]);

    return { handleDownload };
}
