'use client';

import React from 'react';
import { CircleAlert, Loader2, Music, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { MyScoresBulkActions } from '@/components/my-scores/my-scores-bulk-actions';
import { MyScoresFilterBar } from '@/components/my-scores/my-scores-filter-bar';
import { MyScoresPagination } from '@/components/my-scores/my-scores-pagination';
import { MyScoreCard } from '@/components/my-scores/my-score-card';
import { isProcessingJob, ProcessingJobCard } from '@/components/my-scores/processing-job-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Footer } from '@/components/layout/footer';
import { useAddOwnedScoresToLibrary } from '@/hooks/queries/use-library-queries';
import { useDeleteJob, useJobList } from '@/hooks/queries/use-job-queries';
import { useArchiveMyScores, useDeleteMyScores, useMyScores } from '@/hooks/queries/use-my-scores-queries';
import type { MyScoresPageView, MyScoresSort, MyScoresView } from '@/types/api';

const SCORE_VIEWS: MyScoresView[] = ['all', 'drafts', 'private', 'published', 'archived'];
const VIEWS: MyScoresPageView[] = [
  'all',
  'processing',
  'failed',
  'drafts',
  'private',
  'published',
  'archived',
];

function normalizeView(value?: string): MyScoresPageView {
  return VIEWS.includes(value as MyScoresPageView) ? (value as MyScoresPageView) : 'all';
}

function isScoreView(view: MyScoresPageView): view is MyScoresView {
  return SCORE_VIEWS.includes(view as MyScoresView);
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
  const [searchInput, setSearchInput] = React.useState(params.search ?? '');
  const page = Math.max(1, Number(params.page ?? 1));
  const pageSize = 20;
  const scoreView = isScoreView(view) ? view : 'all';
  const showScores = isScoreView(view);
  const scoresQuery = useMyScores({
    view: scoreView,
    search: params.search,
    sort,
    page,
    pageSize,
    enabled: showScores,
  });
  const jobsQuery = useJobList(1, 20);
  const deleteJob = useDeleteJob();
  const addToLibrary = useAddOwnedScoresToLibrary();
  const deleteScores = useDeleteMyScores();
  const archiveScores = useArchiveMyScores();
  const scores = React.useMemo(() => scoresQuery.data?.data ?? [], [scoresQuery.data?.data]);
  const jobs = jobsQuery.data?.data ?? [];
  const [selectedScoreIds, setSelectedScoreIds] = React.useState<Set<string>>(new Set());
  const selectedCount = selectedScoreIds.size;
  const scoreIds = React.useMemo(() => scores.map((score) => score.score_id), [scores]);
  const visibleJobs = jobs.filter((job) => {
    if (view === 'processing') return isProcessingJob(job);
    if (view === 'failed') return job.state === 'FAILURE';
    return isProcessingJob(job) || job.state === 'FAILURE';
  });
  const total = showScores
    ? (scoresQuery.data?.pagination.total ?? 0) + (view === 'all' ? visibleJobs.length : 0)
    : visibleJobs.length;
  const scorePagination = scoresQuery.data?.pagination;
  const canGoPrevious = showScores && scorePagination ? scorePagination.page > 1 : false;
  const canGoNext = showScores && scorePagination
    ? scorePagination.page < scorePagination.total_pages
    : false;

  React.useEffect(() => {
    setSelectedScoreIds(new Set());
  }, [view, params.search, sort, page]);

  const toggleScoreSelection = (scoreId: string) => {
    setSelectedScoreIds((current) => {
      const next = new Set(current);
      if (next.has(scoreId)) {
        next.delete(scoreId);
      } else {
        next.add(scoreId);
      }
      return next;
    });
  };
  const selectVisibleScores = () => setSelectedScoreIds(new Set(scoreIds));
  const clearSelection = () => setSelectedScoreIds(new Set());
  const selectedIds = () => Array.from(selectedScoreIds);

  const navigate = (next: {
    view?: MyScoresPageView;
    search?: string | null;
    sort?: MyScoresSort;
    page?: number;
  }) => {
    const query = new URLSearchParams();
    query.set('view', next.view ?? view);
    const nextSearch = next.search === undefined ? params.search : next.search;
    const nextSort = next.sort ?? sort;
    if (nextSearch) query.set('search', nextSearch);
    if (nextSort !== 'updated_desc') query.set('sort', nextSort);
    if (next.page && next.page > 1) query.set('page', String(next.page));
    router.push(`/my-scores?${query.toString()}`);
  };
  const handleAddToLibrary = () => {
    addToLibrary.mutate(
      { score_ids: selectedIds() },
      { onSuccess: clearSelection }
    );
  };
  const handleDeleteSelected = () => {
    if (!window.confirm(t('confirmDeleteSelected', { count: selectedCount }))) {
      return;
    }
    deleteScores.mutate(selectedIds(), { onSuccess: clearSelection });
  };
  const handleArchiveSelected = () => {
    archiveScores.mutate(selectedIds(), { onSuccess: clearSelection });
  };
  const goToPage = (nextPage: number) => {
    navigate({ page: nextPage });
  };
  const submitSearch = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    navigate({ search: searchInput.trim() || null, page: 1 });
  };
  const isLoading = (showScores && scoresQuery.isLoading) || jobsQuery.isLoading;
  const isError = (showScores && scoresQuery.isError) || jobsQuery.isError;
  const loadError = scoresQuery.error ?? jobsQuery.error;

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
          <MyScoresFilterBar
            searchInput={searchInput}
            sort={sort}
            hasSearch={Boolean(params.search)}
            onSearchInputChange={setSearchInput}
            onSubmit={submitSearch}
            onSortChange={(value) => navigate({ sort: value, page: 1 })}
            onClearSearch={() => {
              setSearchInput('');
              navigate({ search: null, page: 1 });
            }}
            t={t}
          />
          <div className="mb-5">
            <h2 className="text-2xl font-bold">{t(`views.${view}`)}</h2>
            <p className="text-sm text-muted-foreground">{t('totalScores', { count: total })}</p>
          </div>
          {showScores && scores.length ? (
            <MyScoresBulkActions
              selectedCount={selectedCount}
              addToLibraryPending={addToLibrary.isPending}
              archivePending={archiveScores.isPending}
              deletePending={deleteScores.isPending}
              onSelectVisible={selectVisibleScores}
              onClearSelection={clearSelection}
              onAddToLibrary={handleAddToLibrary}
              onArchiveSelected={handleArchiveSelected}
              onDeleteSelected={handleDeleteSelected}
              t={t}
            />
          ) : null}
          {isLoading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-8 w-8 animate-spin text-primary" />
            </div>
          ) : isError ? (
            <Alert variant="destructive">
              <CircleAlert className="h-4 w-4" />
              <AlertTitle>{t('loadFailed')}</AlertTitle>
              <AlertDescription>
                {loadError instanceof Error ? loadError.message : t('loadFailedDesc')}
              </AlertDescription>
            </Alert>
          ) : visibleJobs.length || scores.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {visibleJobs.map((job) => (
                <ProcessingJobCard
                  key={job.job_id}
                  job={job}
                  deletePending={deleteJob.isPending}
                  onOpenScore={() => router.push(`/results/${job.score_id}?from=my-scores`)}
                  onDismiss={() => deleteJob.mutate(job.job_id)}
                  t={t}
                />
              ))}
              {showScores ? scores.map((score) => (
                <MyScoreCard
                  key={score.score_id}
                  score={score}
                  view={scoreView}
                  selected={selectedScoreIds.has(score.score_id)}
                  onOpen={() => router.push(`/results/${score.score_id}?from=my-scores`)}
                  onToggleSelection={() => toggleScoreSelection(score.score_id)}
                  t={t}
                />
              )) : null}
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
          {showScores && scorePagination && scorePagination.total_pages > 1 ? (
            <MyScoresPagination
              page={scorePagination.page}
              totalPages={scorePagination.total_pages}
              canGoPrevious={canGoPrevious}
              canGoNext={canGoNext}
              onPageChange={goToPage}
              t={t}
            />
          ) : null}
        </div>
      </main>
      <Footer />
    </div>
  );
}
