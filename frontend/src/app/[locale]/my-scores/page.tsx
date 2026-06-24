'use client';

import React from 'react';
import { CircleAlert, Edit, Loader2, Music, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Footer } from '@/components/layout/footer';
import { useMyScores } from '@/hooks/queries/use-my-scores-queries';
import { formatApiDateTime } from '@/lib/score/metadata-display';
import { cn } from '@/lib/utils';
import type { MyScoresSort, MyScoresView, ScoreState } from '@/types/api';

const VIEWS: MyScoresView[] = ['all', 'drafts', 'private', 'published'];

function normalizeView(value?: string): MyScoresView {
  return VIEWS.includes(value as MyScoresView) ? (value as MyScoresView) : 'all';
}

function stateLabelKey(state: ScoreState, view: MyScoresView) {
  if (view === 'published') return 'publishedStatus';
  if (state === 'IN_REVIEW') return 'draftStatus';
  if (state === 'ARCHIVED') return 'archivedStatus';
  return 'privateStatus';
}

export default function MyScoresPage({
  searchParams,
}: {
  searchParams: Promise<{
    view?: string;
    search?: string;
    sort?: string;
    page?: string;
  }>;
}) {
  const params = React.use(searchParams);
  const t = useTranslations('myScores');
  const router = useRouter();
  const view = normalizeView(params.view);
  const sort: MyScoresSort = params.sort === 'name_asc' ? 'name_asc' : 'updated_desc';
  const page = Math.max(1, Number(params.page ?? 1));
  const pageSize = 20;
  const scoresQuery = useMyScores({
    view,
    search: params.search,
    sort,
    page,
    pageSize,
  });
  const scores = scoresQuery.data?.data ?? [];
  const total = scoresQuery.data?.pagination.total ?? 0;

  const navigate = (next: { view?: MyScoresView; page?: number }) => {
    const query = new URLSearchParams();
    query.set('view', next.view ?? view);
    if (params.search) query.set('search', params.search);
    if (params.sort) query.set('sort', params.sort);
    if (next.page && next.page > 1) query.set('page', String(next.page));
    router.push(`/my-scores?${query.toString()}`);
  };

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="bg-gray-900">
        <div className="mx-auto max-w-7xl px-4 pb-14 pt-28">
          <h1 className="text-4xl font-bold text-white sm:text-5xl">{t('title')}</h1>
          <p className="mt-3 text-lg text-gray-300">{t('subtitle')}</p>
        </div>
      </div>
      <main className="grow">
        <div className="mx-auto max-w-7xl px-4 py-10">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {VIEWS.map((item) => (
                <Button
                  key={item}
                  variant={item === view ? 'default' : 'outline'}
                  onClick={() => navigate({ view: item })}
                >
                  {t(`views.${item}`)}
                </Button>
              ))}
            </div>
            <Button asChild>
              <Link href="/upload">
                <Upload className="mr-2 h-4 w-4" />
                {t('uploadScore')}
              </Link>
            </Button>
          </div>
          <div className="mb-5">
            <h2 className="text-2xl font-bold">{t(`views.${view}`)}</h2>
            <p className="text-sm text-muted-foreground">{t('totalScores', { count: total })}</p>
          </div>
          {scoresQuery.isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : scoresQuery.isError ? (
            <Alert variant="destructive">
              <CircleAlert className="h-4 w-4" />
              <AlertTitle>{t('loadFailed')}</AlertTitle>
              <AlertDescription>
                {scoresQuery.error instanceof Error ? scoresQuery.error.message : t('loadFailedDesc')}
              </AlertDescription>
            </Alert>
          ) : scores.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {scores.map((score) => (
                <Card
                  key={score.score_id}
                  className="cursor-pointer rounded-2xl transition hover:-translate-y-0.5 hover:shadow-lg"
                  onClick={() => router.push(`/results/${score.score_id}?from=my-scores`)}
                >
                  <CardContent className="p-5">
                    <div className="mb-4 flex h-32 items-center justify-center rounded-xl bg-muted">
                      <Music className="h-10 w-10 text-muted-foreground" />
                    </div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h3 className="truncate font-semibold">{score.title}</h3>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatApiDateTime(score.updated_at)}
                        </p>
                      </div>
                      <span
                        className={cn(
                          'rounded-full px-2 py-1 text-xs',
                          score.state === 'IN_REVIEW'
                            ? 'bg-amber-100 text-amber-700'
                            : 'bg-primary/10 text-primary'
                        )}
                      >
                        {t(stateLabelKey(score.state, view))}
                      </span>
                    </div>
                    <div className="mt-4 flex gap-2">
                      <Button asChild size="sm" variant="outline" onClick={(event) => event.stopPropagation()}>
                        <Link
                          href={`/editor/${score.score_id}?returnUrl=${encodeURIComponent(`/results/${score.score_id}?from=my-scores`)}`}
                        >
                          <Edit className="mr-2 h-4 w-4" />
                          {t('edit')}
                        </Link>
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <Card className="rounded-2xl">
              <CardContent className="py-20 text-center">
                <Music className="mx-auto mb-4 h-14 w-14 text-muted-foreground" />
                <p className="text-muted-foreground">
                  {params.search ? t('emptySearch') : t(`empty.${view}`)}
                </p>
                <Button className="mt-4" asChild>
                  <Link href="/upload">{t('uploadScore')}</Link>
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </main>
      <Footer />
    </div>
  );
}
