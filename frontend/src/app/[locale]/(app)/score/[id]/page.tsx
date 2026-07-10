'use client';

import React, { Suspense } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ScoreCapabilityProvider } from '@/components/score/score-capability-context';
import { ScoreSurface } from '@/components/score/score-surface';
import { ScoreActions } from '@/components/score-detail/score-actions';
import { ScoreBreadcrumbs } from '@/components/score-detail/score-breadcrumbs';
import { ScoreMetadataEditor } from '@/components/score-detail/score-metadata-editor';
import { ScorePlayer } from '@/components/score-detail/score-player';
import { ScoreStyleTagsEditor } from '@/components/score-detail/score-style-tags-editor';
import { EditorProvider } from '@/contexts/editor-provider';
import { useScoreDetailResources } from '@/hooks/score-detail/use-score-detail-resources';
import { ApiError } from '@/lib/api-client';
import { translateErrorCode } from '@/lib/i18n/error-message';
import { parseScoreDetailSource } from '@/lib/score-detail/navigation';

function ScorePageContent({ id, source }: { id: string; source: 'shares' | 'my-scores' | null }) {
  const t = useTranslations('score');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const resources = useScoreDetailResources(id);
  const error = resources.scoreError instanceof ApiError && resources.scoreError.code
    ? translateErrorCode(errors, resources.scoreError.code)
    : resources.scoreError instanceof Error
      ? resources.scoreError.message
      : null;
  const scoreTitle = resources.score?.title || resources.parsedTitle || t('scoreFallbackTitle', {
    id: id.slice(0, 8),
  });
  const capabilities = resources.score?.capabilities ?? null;

  if (resources.scoreLoading) {
    return (
      <ScoreSurface>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <PageHeader title={t('title')} />
          <div className="flex min-h-[40vh] items-center justify-center">
            <div className="text-center">
              <Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-orange-500" />
              <p className="text-gray-600">{common('loading')}</p>
            </div>
          </div>
        </div>
      </ScoreSurface>
    );
  }

  if (error) {
    return (
      <ScoreSurface>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <PageHeader title={t('title')} />
          <div className="flex min-h-[40vh] items-center justify-center py-16">
            <div className="mx-4 w-full max-w-md text-center">
              <CircleAlert className="mx-auto mb-6 h-14 w-14 text-destructive" />
              <h2 className="mb-3 text-2xl font-bold text-gray-900">{common('loadFailed')}</h2>
              <p className="mb-2 text-gray-600">{error}</p>
              <p className="mb-8 text-sm text-gray-500">{t('loadFailedHint')}</p>
              <Button asChild className="px-8">
                <Link href={source === 'my-scores' ? '/my-scores' : '/library'}>
                  {source === 'my-scores' ? common('nav.myScores') : t('backToLibrary')}
                </Link>
              </Button>
            </div>
          </div>
        </div>
      </ScoreSurface>
    );
  }

  return (
    <ScoreCapabilityProvider capabilities={capabilities} scoreId={id} workspace="view">
      <ScoreSurface>
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
          <PageHeader title={scoreTitle} description={t('subtitle')} />
          <ScoreBreadcrumbs scoreTitle={scoreTitle} source={source} />
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <ScorePlayer rawXml={resources.rawXml} />
            </div>
            <div className="sticky top-24 space-y-6 lg:col-span-1">
              <ScoreMetadataEditor
                imageCount={resources.imageCount}
                scoreId={id}
                score={resources.score}
                parsedTitle={resources.parsedTitle}
              />
              <ScoreActions
                artifacts={resources.artifacts}
                revisionId={resources.score?.head_revision_id}
                scoreTitle={scoreTitle}
                scoreId={id}
              />
              <ScoreStyleTagsEditor
                taxonomyTags={resources.score?.taxonomy_tags ?? []}
                scoreId={id}
                version={resources.score?.version ?? 1}
              />
            </div>
          </div>
        </div>
      </ScoreSurface>
    </ScoreCapabilityProvider>
  );
}

export default function ScorePageWithProvider({
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
      <EditorProvider><ScorePageContent id={id} source={source} /></EditorProvider>
    </Suspense>
  );
}
