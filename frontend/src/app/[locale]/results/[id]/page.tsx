'use client';

import React, { Suspense } from 'react';
import { CircleAlert, Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/routing';
import { Button } from '@/components/ui/button';
import { Footer } from '@/components/layout/footer';
import { ResultsActions } from '@/components/results/results-actions';
import { ResultsBreadcrumbs } from '@/components/results/results-breadcrumbs';
import { ResultsDifficultyEditor } from '@/components/results/results-difficulty-editor';
import { ResultsMetadataEditor } from '@/components/results/results-metadata-editor';
import { ResultsScorePlayer } from '@/components/results/results-score-player';
import { EditorProvider } from '@/contexts/editor-provider';
import { useResultsResources } from '@/hooks/results/use-results-resources';
import { ApiError } from '@/lib/api-client';
import { parseResultsHistorySource } from '@/lib/results/navigation';

function ResultsPageContent({ id, source }: { id: string; source: 'shares' | 'uploads' | null }) {
  const t = useTranslations('results');
  const common = useTranslations('common');
  const errors = useTranslations('errors');
  const history = useTranslations('history');
  const resources = useResultsResources(id);
  const error = resources.taskError instanceof ApiError && resources.taskError.code
    ? errors(resources.taskError.code as never)
    : resources.taskError instanceof Error
      ? resources.taskError.message
      : null;
  const scoreTitle = resources.task?.title || resources.parsedTitle || history('taskLabel', {
    id: id.slice(0, 8),
  });

  if (resources.taskLoading) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1></div></div>
        <main className="flex grow items-center justify-center"><div className="text-center"><Loader2 className="mx-auto mb-4 h-12 w-12 animate-spin text-orange-500" /><p className="text-gray-600">{common('loading')}</p></div></main>
        <Footer />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen flex-col bg-gray-50">
        <div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1></div></div>
        <main className="flex grow items-center justify-center py-16">
          <div className="mx-4 w-full max-w-md text-center">
            <CircleAlert className="mx-auto mb-6 h-14 w-14 text-destructive" />
            <h2 className="mb-3 text-2xl font-bold text-gray-900">{common('loadFailed')}</h2>
            <p className="mb-2 text-gray-600">{error}</p>
            <p className="mb-8 text-sm text-gray-500">{t('loadFailedHint')}</p>
            <Button asChild className="px-8"><Link href="/history">{t('backToHistory')}</Link></Button>
          </div>
        </main>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 pb-16 pt-32">
          <div className="text-center">
            <h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1>
            <p className="text-lg text-gray-300">{t('subtitle')}</p>
          </div>
        </div>
      </div>

      <main className="grow">
        <div className="mx-auto max-w-7xl px-4 py-16">
          <ResultsBreadcrumbs scoreTitle={scoreTitle} source={source} />
          <div className="grid grid-cols-1 items-start gap-8 lg:grid-cols-3">
            <div className="space-y-6 lg:col-span-2">
              <ResultsScorePlayer rawXml={resources.rawXml} />
            </div>
            <div className="sticky top-8 space-y-6 lg:col-span-1">
              <ResultsMetadataEditor
                imageCount={resources.imageCount}
                taskId={id}
                task={resources.task}
                parsedTitle={resources.parsedTitle}
              />
              <ResultsActions
                imageCount={resources.imageCount}
                scoreTitle={scoreTitle}
                taskId={id}
              />
              <ResultsDifficultyEditor difficulty={resources.task?.difficulty} taskId={id} />
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}

export default function ResultsPageWithProvider({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ from?: string }>;
}) {
  const { id } = React.use(params);
  const { from } = React.use(searchParams);
  const source = parseResultsHistorySource(from);
  return (
    <Suspense fallback={null}>
      <EditorProvider><ResultsPageContent id={id} source={source} /></EditorProvider>
    </Suspense>
  );
}
