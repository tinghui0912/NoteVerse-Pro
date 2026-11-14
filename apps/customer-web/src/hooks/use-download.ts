'use client';

import { useCallback } from 'react';
import { scoresApi } from '@/lib/api';
import type { ScoreRevisionAssetsRead } from '@/generated/api';
import { useToast } from '@/hooks/use-toast';
import { useTranslations } from 'next-intl';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { reportUnexpectedClientError } from '@/lib/observability';

interface UseDownloadOptions {
    id: string;
    assets?: ScoreRevisionAssetsRead;
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

const emptyAssets: ScoreRevisionAssetsRead = { revision_sources: [], render_assets: [] };

export function useDownload({ id, assets = emptyAssets }: UseDownloadOptions): UseDownloadReturn {
    const { toast } = useToast();
    const t = useTranslations('download');
    const tErrors = useTranslations('errors');

    const handleDownload = useCallback(async (type: 'image' | 'xml') => {
        try {
            if (type === 'xml') {
                const source = assets.revision_sources.find((item) => item.format === 'MUSICXML');
                if (!source) throw new Error('FILE_NOT_FOUND');
                const blob = await scoresApi.downloadRevisionSource(source.source_id);
                triggerDownload(blob, `score_${id}.musicxml`);
                return;
            } else {
                const pages = assets.render_assets.filter((item) => item.kind === 'RENDERED_PAGE');
                if (!pages.length) throw new Error('FILE_NOT_FOUND');
                const blob = pages.length === 1
                    ? await scoresApi.downloadRenderAsset(pages[0].render_asset_id)
                    : await scoresApi.downloadRenderAssetArchive(id, pages[0].revision_id, 'RENDERED_PAGE');
                triggerDownload(
                    blob,
                    pages.length === 1 ? `score_${id}.${extensionFromBlob(blob)}` : `score_${id}.zip`
                );
                return;
            }
        } catch (error: unknown) {
            reportUnexpectedClientError(error, {
                area: 'download',
                action: 'download_asset',
                id,
                type,
            });
            toast({
                title: t('downloadFailed'),
                description: userFacingErrorMessage(tErrors, error, t('downloadFailedDesc')),
                variant: 'destructive',
            });
        }
    }, [id, assets, toast, t, tErrors]);

    return { handleDownload };
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
