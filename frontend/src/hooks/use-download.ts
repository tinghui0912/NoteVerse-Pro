'use client';

import { useCallback } from 'react';
import { filesApi, publicationsApi, scoresApi, scoreSharingApi } from '@/lib/api';
import type { ScoreRevisionAssets } from '@/types/api';
import { useToast } from '@/hooks/use-toast';
import { useTranslations } from 'next-intl';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { reportUnexpectedClientError } from '@/lib/observability';

interface UseDownloadOptions {
    mode: 'score' | 'grant' | 'publication';
    id: string;
    assets?: ScoreRevisionAssets;
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

const emptyAssets: ScoreRevisionAssets = { revision_sources: [], render_assets: [] };

export function useDownload({ mode, id, assets = emptyAssets }: UseDownloadOptions): UseDownloadReturn {
    const { toast } = useToast();
    const t = useTranslations('download');
    const tErrors = useTranslations('errors');

    const handleDownload = useCallback(async (type: 'image' | 'xml') => {
        try {
            if (type === 'xml') {
                if (mode === 'grant') {
                    const source = assets.revision_sources.find((item) => item.format === 'MUSICXML');
                    if (!source) throw new Error('FILE_NOT_FOUND');
                    const blob = await scoreSharingApi.downloadRevisionSource(id, source.source_id);
                    filesApi.triggerDownload(blob, `score_${source.revision_id}.musicxml`);
                    return;
                }
                if (mode === 'score') {
                    const source = assets.revision_sources.find((item) => item.format === 'MUSICXML');
                    if (!source) throw new Error('FILE_NOT_FOUND');
                    const blob = await scoresApi.downloadRevisionSource(source.source_id);
                    filesApi.triggerDownload(blob, `score_${id}.musicxml`);
                    return;
                }
                if (mode === 'publication') {
                    const source = assets.revision_sources.find((item) => item.format === 'MUSICXML');
                    if (!source) throw new Error('FILE_NOT_FOUND');
                    const blob = await publicationsApi.downloadRevisionSource(id, source.source_id);
                    filesApi.triggerDownload(blob, source.filename);
                    return;
                }
            } else {
                if (mode === 'grant') {
                    const pages = assets.render_assets.filter((item) => item.kind === 'RENDERED_PAGE');
                    if (!pages.length) throw new Error('FILE_NOT_FOUND');
                    for (const page of pages) {
                        const blob = await scoreSharingApi.downloadRenderAsset(id, page.render_asset_id);
                        filesApi.triggerDownload(blob, page.filename);
                    }
                    return;
                }
                if (mode === 'score') {
                    const pages = assets.render_assets.filter((item) => item.kind === 'RENDERED_PAGE');
                    if (!pages.length) throw new Error('FILE_NOT_FOUND');
                    const blob = pages.length === 1
                        ? await scoresApi.downloadRenderAsset(pages[0].render_asset_id)
                        : await scoresApi.downloadRenderAssetArchive(id, pages[0].revision_id, 'RENDERED_PAGE');
                    filesApi.triggerDownload(
                        blob,
                        pages.length === 1 ? `score_${id}.${extensionFromBlob(blob)}` : `score_${id}.zip`
                    );
                    return;
                }
                if (mode === 'publication') {
                    const pages = assets.render_assets.filter((item) => item.kind === 'RENDERED_PAGE');
                    if (!pages.length) throw new Error('FILE_NOT_FOUND');
                    for (const page of pages) {
                        const blob = await publicationsApi.downloadRenderAsset(id, page.render_asset_id);
                        filesApi.triggerDownload(blob, page.filename);
                    }
                    return;
                }
            }
        } catch (error: unknown) {
            reportUnexpectedClientError(error, {
                area: 'download',
                action: 'download_asset',
                mode,
                id,
                type,
            });
            toast({
                title: t('downloadFailed'),
                description: userFacingErrorMessage(tErrors, error, t('downloadFailedDesc')),
                variant: 'destructive',
            });
        }
    }, [mode, id, assets, toast, t, tErrors]);

    return { handleDownload };
}
