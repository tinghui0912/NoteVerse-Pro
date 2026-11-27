'use client';

import Image from 'next/image';
import { useQuery } from '@tanstack/react-query';
import { principalIndependentQueryMeta } from '@/lib/query-auth-scope';
import { useTranslations } from 'next-intl';
import { useGuestPreview } from '@/features/scores/guest-preview/queries';
import { guestPreviewQueryKeys } from './query-keys';
import { guestPreviewApi } from '@/features/scores/guest-preview/api';
import { ResourceLoading } from '@/components/loading';
import { ResourceLoadError } from '@/components/states';

export function GuestPreviewPage({ token }: { token: string }) {
  const t = useTranslations('guestPreview');
  const query = useGuestPreview(token);
  const preview = query.data;
  if (query.isLoading) return <ResourceLoading label={t('loading')} minHeight="md" />;
  if (query.error || !preview) {
    return <ResourceLoadError title={t('title')} description={t('unavailable')} />;
  }
  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8" data-testid="guest-preview">
      <h1 className="text-2xl font-semibold">{preview.display_title}</h1>
      <p>{t('by', { name: preview.shared_by })}</p>
      <p className="text-muted-foreground">{t('description')}</p>
      {preview.audio_available ? (
        <GuestPreviewAudio token={token} />
      ) : (
        <p>{t('audioUnavailable')}</p>
      )}
      <section aria-label={t('pages')} className="space-y-4">
        {preview.render_assets.length ? (
          preview.render_assets.map((page) => (
            <Image
              unoptimized
              width={1000}
              height={1400}
              key={page.asset_id}
              src={guestPreviewApi.pageUrl(token, page.asset_id)}
              alt={t('page', { number: page.page_number })}
              className="h-auto w-full"
            />
          ))
        ) : (
          <p>{t('pagesUnavailable')}</p>
        )}
      </section>
    </main>
  );
}


function GuestPreviewAudio({ token }: { token: string }) {
  const t = useTranslations('guestPreview');
  const access = useQuery({
    queryKey: [...guestPreviewQueryKeys.public(token), 'playback'],
    meta: principalIndependentQueryMeta,
    queryFn: ({signal}) => guestPreviewApi.playbackAccess(token,signal),
    retry: false,
    gcTime: 0,
    refetchInterval: query => query.state.data ? Math.max(1000,(query.state.data.expires_in-30)*1000) : false,
  });
  return <div>
    {access.data ? <audio controls controlsList="nodownload" src={access.data.playback_url} aria-label={t('audio')} /> : <p>{t('audioUnavailable')}</p>}
    <button type="button" onClick={() => void access.refetch()} disabled={access.isFetching}>{t('refreshPlayback')}</button>
    {access.error ? <p role="alert">{t('audioUnavailable')}</p> : null}
  </div>;
}
