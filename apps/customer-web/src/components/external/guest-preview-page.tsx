'use client';

import Image from 'next/image';
import { useTranslations } from 'next-intl';
import { useGuestPreview } from '@/hooks/guest-preview/use-guest-preview';
import { guestPreviewsApi } from '@/lib/api';
import { ResourceLoading } from '@/components/loading';
import { ResourceLoadError } from '@/components/states';
import { ApiError } from '@/lib/api-client';

export function GuestPreviewPage({ token }: { token: string }) {
  const t = useTranslations('guestPreview');
  const query = useGuestPreview(token);
  const preview = query.data?.data;
  if (query.isLoading) return <ResourceLoading label={t('loading')} minHeight="md" />;
  if (query.error || !preview) {
    const code = query.error instanceof ApiError ? query.error.code : '';
    const description = code === 'guest_preview_revoked'
      ? t('revoked')
      : code === 'guest_preview_expired'
        ? t('expired')
        : t('unavailable');
    return <ResourceLoadError title={t('title')} description={description} />;
  }
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8" data-testid="guest-preview">
      <h1 className="text-2xl font-semibold">{preview.title}</h1>
      <p>{t('by', { name: preview.shared_by })}</p>
      <p className="text-muted-foreground">{t('description')}</p>
      {preview.audio_available ? (
        <audio
          controls
          controlsList="nodownload"
          src={guestPreviewsApi.playbackUrl(token)}
          aria-label={t('audio')}
        />
      ) : <p>{t('audioUnavailable')}</p>}
      <section aria-label={t('pages')} className="space-y-4">
        {preview.render_assets.length ? preview.render_assets.map((page) => (
          <Image unoptimized
            width={1000}
            height={1400}
            key={page.asset_id}
            src={guestPreviewsApi.pageUrl(token, page.asset_id)}
            alt={t('page', { number: page.page_number })}
            className="h-auto w-full"
          />
        )) : <p>{t('pagesUnavailable')}</p>}
      </section>
    </main>
  );
}
