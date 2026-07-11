'use client';

import React, { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { ResourceLoading } from '@/components/loading';
import { PageHeader } from '@/components/page';
import { ScoreCapabilityProvider } from '@/components/score/score-capability-context';
import { ScoreSurface } from '@/components/score/score-surface';
import { ScoreBreadcrumbs } from '@/components/score-detail/score-breadcrumbs';
import { ScoreCollaborationPanel } from '@/components/score-detail/score-collaboration-panel';
import { ScoreDetailHero } from '@/components/score-detail/score-detail-hero';
import { ScoreDetailTabs } from '@/components/score-detail/score-detail-tabs';
import { ScoreHeroActions } from '@/components/score-detail/score-hero-actions';
import { ScoreInfoPanel } from '@/components/score-detail/score-info-panel';
import { ScoreSharePanel } from '@/components/score-detail/score-share-panel';
import { ResourceLoadError } from '@/components/states';
import { useScoreDetailSummary } from '@/hooks/score-detail/use-score-detail-summary';
import { scoresApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { formatApiDateTime } from '@/lib/date-time';
import { translateErrorCode } from '@/lib/i18n/error-message';
import { parseScoreDetailSource } from '@/lib/score-detail/navigation';
import { scoreThumbnailUrl } from '@/lib/score-detail/thumbnail';

function ScorePageContent({ id, source }: { id: string; source: 'shares' | 'my-scores' | null }) {
  const t = useTranslations('score');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const resources = useScoreDetailSummary(id);
  const error = resources.scoreError instanceof ApiError && resources.scoreError.code
    ? translateErrorCode(errors, resources.scoreError.code)
    : resources.scoreError
      ? common('loadFailed')
      : null;
  const scoreTitle = resources.score?.title || t('scoreFallbackTitle', { id: id.slice(0, 8) });
  const capabilities = resources.score?.capabilities ?? null;

  if (resources.scoreLoading) {
    return (
      <ScoreSurface>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <PageHeader title={t('title')} />
          <ResourceLoading label={common('loadingScoreData')} minHeight="md" />
        </div>
      </ScoreSurface>
    );
  }

  if (error || !resources.score) {
    return (
      <ScoreSurface>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <PageHeader title={t('title')} />
          <ResourceLoadError
            title={common('loadFailed')}
            description={error ?? common('loadFailed')}
            actionLabel={source === 'my-scores' ? common('nav.myScores') : t('backToLibrary')}
            actionHref={source === 'my-scores' ? '/my-scores' : '/library'}
            className="min-h-[40vh]"
          />
        </div>
      </ScoreSurface>
    );
  }

  const score = resources.score;
  const loadPlaybackXml = async () => {
    if (!score.head_revision_id) return null;
    const response = await scoresApi.revisionContent(score.score_id, score.head_revision_id);
    return response.data?.content ?? null;
  };

  return (
    <ScoreCapabilityProvider capabilities={capabilities} scoreId={id} workspace="view">
      <ScoreSurface>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <ScoreBreadcrumbs scoreTitle={scoreTitle} source={source} />
          <ScoreDetailHero
            title={scoreTitle}
            thumbnailUrl={scoreThumbnailUrl(score.thumbnail_artifact_id)}
            loadPlaybackXml={loadPlaybackXml}
            playbackEnabled={Boolean(score.head_revision_id)}
            status={score.publication?.status === 'PUBLISHED' ? (
              <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-medium text-emerald-700">
                {t('publishedStatus')}
              </span>
            ) : null}
            actions={(
              <ScoreHeroActions
                artifacts={resources.artifacts}
                revisionId={score.head_revision_id}
                scoreId={score.score_id}
              />
            )}
            meta={(
              <>
                <span>{t('lastModifiedTime')} {formatApiDateTime(score.updated_at)}</span>
                <span aria-hidden="true">·</span>
                <span>{t('versionLabel', { version: score.version })}</span>
              </>
            )}
          />
          <ScoreDetailTabs
            tabs={[
              {
                value: 'info',
                label: t('scoreInfo'),
                content: (
                  <ScoreInfoPanel
                    canEditTitle
                    createdAt={score.created_at}
                    imageCount={resources.imageCount}
                    metadata={score.metadata}
                    scoreId={score.score_id}
                    taxonomyTags={score.taxonomy_tags}
                    title={scoreTitle}
                    updatedAt={score.updated_at}
                    version={score.version}
                  />
                ),
              },
              score.capabilities.can_manage_sharing ? {
                value: 'share',
                label: t('createShareAction'),
                content: (
                  <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
                    <ScoreSharePanel scoreId={score.score_id} scoreTitle={scoreTitle} />
                  </div>
                ),
              } : null,
              score.capabilities.can_manage_members ? {
                value: 'collaboration',
                label: t('collaborationAction'),
                content: (
                  <div className="rounded-2xl border bg-white p-5 shadow-sm sm:p-6">
                    <ScoreCollaborationPanel scoreId={score.score_id} scoreTitle={scoreTitle} />
                  </div>
                ),
              } : null,
            ].filter((tab): tab is NonNullable<typeof tab> => Boolean(tab))}
          />
        </div>
      </ScoreSurface>
    </ScoreCapabilityProvider>
  );
}

export default function ScorePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = React.use(params);
  const { from } = React.use(searchParams);
  const source = parseScoreDetailSource(from);
  return (
    <Suspense fallback={null}>
      <ScorePageContent id={id} source={source} />
    </Suspense>
  );
}
