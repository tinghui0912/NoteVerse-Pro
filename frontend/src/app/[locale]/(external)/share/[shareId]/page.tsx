'use client';

import React from 'react';
import { Ban, CircleAlert, Clock3, Loader2, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ResourceLoadError } from '@/components/error/resource-load-error';
import { ScoreCapabilityProvider } from '@/components/score/score-capability-context';
import { ScoreSurface } from '@/components/score/score-surface';
import { ShareInfoSidebar } from '@/components/external/share-info-sidebar';
import { ShareScorePlayer } from '@/components/external/share-score-player';
import { useSharePageData } from '@/hooks/share/use-share-page-data';

export default function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = React.use(params);
  const t = useTranslations('share');
  const common = useTranslations('common');
  const page = useSharePageData(shareId);

  if (page.authLoading || page.loading) {
    return (
      <ScoreSurface>
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </ScoreSurface>
    );
  }
  if (page.error || !page.shareData) {
    const type = page.error?.type ?? 'unknown';
    const config = type === 'not_found'
      ? {
        icon: SearchX,
        title: t('errorNotFoundTitle'),
        description: t('errorNotFoundDesc'),
      }
      : type === 'revoked'
        ? {
          icon: Ban,
          title: t('errorRevokedTitle'),
          description: t('errorRevokedDesc'),
        }
        : type === 'expired'
          ? {
            icon: Clock3,
            title: t('errorExpiredTitle'),
            description: t('errorExpiredDesc'),
          }
          : {
            icon: CircleAlert,
            title: t('loadFailed'),
            description: t('loadFailed'),
          };
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
  const pageCount = data.artifacts.filter((artifact) => artifact.kind === 'RENDERED_PAGE').length;

  return (
    <ScoreCapabilityProvider capabilities={data.capabilities} scoreId={data.score_id} workspace="share">
      <ScoreSurface>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <div className="mb-8">
            <p className="text-sm font-medium text-orange-600">{t('sharedScore')}</p>
            <h1 className="mt-2 text-3xl font-bold tracking-tight text-gray-950 sm:text-4xl">
              {data.title}
            </h1>
            <p className="mt-3 max-w-2xl text-sm text-gray-600 sm:text-base">
              {t('sharedScoreSubtitle')}
            </p>
          </div>
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {page.rawXml ? <ShareScorePlayer rawXml={page.rawXml} /> : null}
            </div>
            <ShareInfoSidebar
              artifacts={data.artifacts}
              imageCount={pageCount}
              isAuthenticated={page.isAuthenticated}
              scoreId={data.score_id}
              scoreTitle={data.title}
              shareData={data}
              shareId={shareId}
              taxonomyTags={data.taxonomy_tags}
            />
          </div>
        </div>
      </ScoreSurface>
    </ScoreCapabilityProvider>
  );
}
