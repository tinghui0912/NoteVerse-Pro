'use client';

import { useMutation } from '@tanstack/react-query';
import { Ban, CircleAlert, Clock3, SearchX } from 'lucide-react';
import React from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { usePathname, useSearchParams } from 'next/navigation';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ResourceLoading } from '@/components/loading';
import { ScoreCapabilityProvider } from '@/components/score/score-capability-context';
import { ScoreSurface } from '@/components/score/score-surface';
import { ExternalScoreActions } from '@/components/score-detail/external-score-actions';
import { ScoreDetailHero } from '@/components/score-detail/score-detail-hero';
import { ScoreDetailTabs } from '@/components/score-detail/score-detail-tabs';
import { ScoreInfoPanel } from '@/components/score-detail/score-info-panel';
import { ResourceLoadError } from '@/components/states';
import { routing } from '@/i18n/routing';
import { useSharePageData } from '@/hooks/share/use-share-page-data';
import { useDownload } from '@/hooks/use-download';
import { useToast } from '@/hooks/use-toast';
import { scoreSharingApi } from '@/lib/api';
import { formatApiDateTime } from '@/lib/date-time';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import { isDerivedAssetPreparing, playableAudioRevisionId } from '@/lib/score-detail/derived-assets';
import { scoreDownloadAvailability } from '@/lib/score-detail/download-availability';
import { shareDerivedThumbnailUrl } from '@/lib/score-detail/thumbnail';

function fallbackInitial(name: string) {
  return name.trim().slice(0, 1).toUpperCase() || 'U';
}

export default function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = React.use(params);
  const t = useTranslations('share');
  const scoreText = useTranslations('score');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const locale = useLocale();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const page = useSharePageData(shareId);
  const { handleDownload } = useDownload({
    mode: 'grant',
    id: shareId,
    assets: page.shareData?.revision_assets,
  });
  const bookmark = useMutation({ mutationFn: () => scoreSharingApi.bookmark(shareId) });

  if (page.authLoading || page.loading) {
    return (
      <ScoreSurface>
        <ResourceLoading label={common('loadingShareData')} minHeight="screen" />
      </ScoreSurface>
    );
  }

  if (page.error || !page.shareData) {
    const type = page.error?.type ?? 'unknown';
    const config = type === 'not_found'
      ? { icon: SearchX, title: t('errorNotFoundTitle'), description: t('errorNotFoundDesc') }
      : type === 'revoked'
        ? { icon: Ban, title: t('errorRevokedTitle'), description: t('errorRevokedDesc') }
        : type === 'expired'
          ? { icon: Clock3, title: t('errorExpiredTitle'), description: t('errorExpiredDesc') }
          : { icon: CircleAlert, title: t('loadFailed'), description: t('loadFailedDesc') };
    return (
      <ScoreSurface>
        <ResourceLoadError
          icon={config.icon}
          title={config.title}
          description={config.description}
          actionLabel={common('nav.home')}
          actionHref="/"
          className="min-h-[calc(100vh-4rem)]"
        />
      </ScoreSurface>
    );
  }

  const data = page.shareData;
  const downloads = scoreDownloadAvailability(data.revision_assets);
  const previewAsset = data.derived_assets.preview;
  const audioAsset = data.derived_assets.audio;
  const audioRevisionId = playableAudioRevisionId(
    data.derived_assets,
    data.capabilities.can_practice
  );
  const audioPreparing = isDerivedAssetPreparing(audioAsset.status);
  const imagePreparing = isDerivedAssetPreparing(previewAsset.status);
  const query = searchParams.toString();
  const localizedSharePath = locale === routing.defaultLocale
    ? `/share/${shareId}`
    : `/${locale}/share/${shareId}`;
  const returnPath = `${pathname || localizedSharePath}${query ? `?${query}` : ''}`;
  const loginHref = `/auth/login?returnUrl=${encodeURIComponent(returnPath)}`;
  const sharedByName = data.shared_by?.display_name || t('anonymousUser');
  const save = () => bookmark.mutate(undefined, {
    onSuccess: () => toast({
      title: t('saveSuccessTitle'),
      description: t('saveSuccessDesc', { scoreName: data.title }),
    }),
    onError: (error) => toast({
      title: t('saveFailed'),
      description: userFacingErrorMessage(errors, error, t('saveFailedDesc')),
      variant: 'destructive',
    }),
  });

  return (
    <ScoreCapabilityProvider capabilities={data.capabilities} scoreId={data.score_id} workspace="share">
      <ScoreSurface>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <ScoreDetailHero
            title={data.title}
            subtitle={t('sharedScore')}
            thumbnailUrl={shareDerivedThumbnailUrl(
              shareId,
              previewAsset.asset_id
            )}
            playbackEnabled={Boolean(audioRevisionId)}
            playbackLoading={audioPreparing}
            playbackVisible={data.capabilities.can_practice}
            playbackAudioSrc={scoreSharingApi.playbackUrl(shareId)}
            actions={(
              <ExternalScoreActions
                canSave={page.isAuthenticated}
                imagePreparing={imagePreparing}
                isSaving={bookmark.isPending}
                onDownloadImage={downloads.canDownloadImage ? () => void handleDownload('image') : undefined}
                onDownloadXml={downloads.canDownloadXml ? () => void handleDownload('xml') : undefined}
                onSave={page.isAuthenticated ? save : undefined}
                saveHref={page.isAuthenticated ? undefined : loginHref}
              />
            )}
            meta={(
              <>
                <span>{t('sharedAt', { date: formatApiDateTime(data.shared_at, locale) })}</span>
              </>
            )}
          />
          <ScoreDetailTabs
            tabs={[
              {
                value: 'info',
                label: scoreText('scoreInfo'),
                content: (
                  <ScoreInfoPanel
                    imageCount={downloads.imageCount}
                    metadata={data.metadata}
                    taxonomyTags={data.taxonomy_tags}
                    title={data.title}
                  />
                ),
              },
              {
                value: 'share',
                label: scoreText('sharedInfo'),
                content: (
                  <Card className="rounded-2xl bg-white shadow-sm">
                    <CardHeader>
                      <CardTitle>{scoreText('sharedBy')}</CardTitle>
                    </CardHeader>
                    <CardContent className="flex items-center gap-3">
                      <Avatar className="h-12 w-12">
                        <AvatarImage src={data.shared_by?.avatar_url ?? undefined} alt={sharedByName} />
                        <AvatarFallback>{fallbackInitial(sharedByName)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <p className="truncate font-medium">{sharedByName}</p>
                        <time className="text-sm text-muted-foreground" dateTime={data.shared_at}>
                          {t('sharedAt', { date: formatApiDateTime(data.shared_at, locale) })}
                        </time>
                      </div>
                    </CardContent>
                  </Card>
                ),
              },
            ]}
          />
        </div>
      </ScoreSurface>
    </ScoreCapabilityProvider>
  );
}
