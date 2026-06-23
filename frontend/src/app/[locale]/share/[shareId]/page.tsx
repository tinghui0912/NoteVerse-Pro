'use client';

import React from 'react';
import { Ban, CircleAlert, Clock3, Loader2, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Footer } from '@/components/layout/footer';
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
      <div className="flex min-h-screen items-center justify-center bg-gray-50">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
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
            description: page.error?.message || t('loadFailed'),
            hint: t('hintNotFound'),
          };
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <div className="bg-gray-900">
          <div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center">
            <div>
              <h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">
                {t('sharedScore')}
              </h1>
              <p className="text-lg text-gray-300">{config.title}</p>
            </div>
          </div>
        </div>
        <main className="flex grow items-center justify-center py-16">
          <div className="mx-4 w-full max-w-md text-center">
            <config.icon className="mx-auto mb-6 h-14 w-14 text-destructive" />
            <h2 className="mb-3 text-2xl font-bold">{config.title}</h2>
            <p className="mb-2 text-gray-600">{config.description}</p>
            <p className="mb-8 text-sm text-gray-500">{config.hint}</p>
            <Button onClick={() => router.push('/')}>{common('nav.home')}</Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  const data = page.shareData;
  const pageCount = data.artifacts.filter((artifact) => artifact.kind === 'RENDERED_PAGE').length;
  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center">
          <div>
            <h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">
              {t('sharedScore')}
            </h1>
            <p className="text-lg text-gray-300">{t('sharedScoreSubtitle')}</p>
          </div>
        </div>
      </div>
      <main className="grow">
        <div className="mx-auto max-w-7xl px-4 py-16">
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              {page.rawXml ? <ShareScorePlayer rawXml={page.rawXml} /> : null}
            </div>
            <ShareInfoSidebar
              artifacts={data.artifacts}
              canDownload={data.capabilities.can_download}
              canPractice={data.capabilities.can_practice}
              imageCount={pageCount}
              isAuthenticated={page.isAuthenticated}
              scoreId={data.score_id}
              scoreTitle={data.title}
              shareData={data}
              shareId={shareId}
              taxonomyTags={data.taxonomy_tags}
            />
          </div>
          <div aria-hidden="true" className="h-36 md:h-28" />
        </div>
      </main>
      <Footer />
    </div>
  );
}
