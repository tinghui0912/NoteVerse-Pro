'use client';

import React from 'react';
import { Ban, CircleAlert, Clock3, Loader2, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { ScoreShell } from '@/components/score-shell/score-shell';
import { ShareInfoSidebar } from '@/components/share/share-info-sidebar';
import { ShareScorePlayer } from '@/components/share/share-score-player';
import { useSharePageData } from '@/hooks/share/use-share-page-data';

export default function SharePage({ params }: { params: Promise<{ shareId: string }> }) {
  const { shareId } = React.use(params);
  const t = useTranslations('share');
  const common = useTranslations('common');
  const router = useRouter();
  const page = useSharePageData(shareId);

  if (page.authLoading || page.loading) {
    return (
      <ScoreShell embedded footer={false}>
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </ScoreShell>
    );
  }
  if (page.error || !page.shareData) {
    const type = page.error?.type ?? 'unknown';
    const config = type === 'not_found'
      ? {
        icon: SearchX,
        title: t('errorNotFoundTitle'),
        description: t('errorNotFoundDesc'),
        hint: t('hintNotFound'),
      }
      : type === 'revoked'
        ? {
          icon: Ban,
          title: t('errorRevokedTitle'),
          description: t('errorRevokedDesc'),
          hint: t('hintRevoked'),
        }
        : type === 'expired'
          ? {
            icon: Clock3,
            title: t('errorExpiredTitle'),
            description: t('errorExpiredDesc'),
            hint: t('hintExpired'),
          }
          : {
            icon: CircleAlert,
            title: t('loadFailed'),
            description: t('loadFailed'),
            hint: t('hintNotFound'),
          };
    return (
      <ScoreShell embedded footer={false}>
        <div className="flex min-h-[calc(100vh-4rem)] items-center justify-center py-16">
          <div className="mx-4 w-full max-w-md text-center">
            <config.icon className="mx-auto mb-6 h-14 w-14 text-destructive" />
            <h2 className="mb-3 text-2xl font-bold">{config.title}</h2>
            <p className="mb-2 text-gray-600">{config.description}</p>
            <p className="mb-8 text-sm text-gray-500">{config.hint}</p>
            <Button onClick={() => router.push('/')}>{common('nav.home')}</Button>
          </div>
        </div>
      </ScoreShell>
    );
  }

  const data = page.shareData;
  const pageCount = data.artifacts.filter((artifact) => artifact.kind === 'RENDERED_PAGE').length;

  return (
    <ScoreShell capabilities={data.capabilities} embedded footer={false} scoreId={data.score_id} workspace="share">
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
    </ScoreShell>
  );
}
