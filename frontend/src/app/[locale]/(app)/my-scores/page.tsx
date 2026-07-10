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
import { ImportJobCard } from '@/components/my-scores/import-job-card';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PageHeader } from '@/components/app-shell/page-header';
import { useDeleteImportJob, useImportJobList } from '@/hooks/queries/use-import-job-queries';
import {
  useDeleteMyScores,
  useMyScores,
  usePublishMyScores,
  useUnpublishMyScores,
} from '@/hooks/queries/use-my-scores-queries';
import {
  buildMyScoresHref,
  isMyScoreView,
  MY_SCORE_PAGE_VIEWS,
  myScoresBulkVisibility,
  myScoresTotal,
  normalizeMyScoresSort,
  normalizeMyScoresView,
  normalizePage,
  scoreBackedView,
  visibleMyScoreJobs,
} from '@/lib/my-scores/state';
import type { MyScoresPageView, MyScoresSort } from '@/types/api';

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
  const view = normalizeMyScoresView(params.view);
  const sort: MyScoresSort = normalizeMyScoresSort(params.sort);
  const [searchInput, setSearchInput] = React.useState(params.search ?? '');
  const page = normalizePage(params.page);
  const pageSize = 20;
  const scoreView = scoreBackedView(view);
  const showScores = isMyScoreView(view);
  const scoresQuery = useMyScores({
    view: scoreView,
    search: params.search,
    sort,
    page,
    pageSize,
    enabled: showScores,
  });
  const showJobs = view === 'all' || view === 'importing' || view === 'review' || view === 'failed';
  const jobsQuery = useImportJobList(1, 20, showJobs);
  const deleteJob = useDeleteImportJob();
  const deleteScores = useDeleteMyScores();
  const publishScores = usePublishMyScores();
  const unpublishScores = useUnpublishMyScores();
  const scores = React.useMemo(() => scoresQuery.data?.data ?? [], [scoresQuery.data?.data]);
  const jobs = React.useMemo(() => jobsQuery.data?.data ?? [], [jobsQuery.data?.data]);
  const [batchMode, setBatchMode] = React.useState(false);
  const [selectedScoreIds, setSelectedScoreIds] = React.useState<Set<string>>(new Set());
  const [selectedJobIds, setSelectedJobIds] = React.useState<Set<string>>(new Set());
  const selectedCount = selectedScoreIds.size;
  const selectedJobCount = selectedJobIds.size;
  const scoreIds = React.useMemo(() => scores.map((score) => score.score_id), [scores]);
  const visibleJobs = visibleMyScoreJobs(jobs, view);
  const visibleSelectableJobIds = visibleJobs
    .filter((job) => job.state === 'FAILURE' || job.state === 'PENDING_REVIEW')
    .map((job) => job.job_id);
  const visibleSelectableCount = scoreIds.length + visibleSelectableJobIds.length;
  const allVisibleSelected =
    visibleSelectableCount > 0 &&
    scoreIds.every((scoreId) => selectedScoreIds.has(scoreId)) &&
    visibleSelectableJobIds.every((jobId) => selectedJobIds.has(jobId));
  const total = myScoresTotal({
    showScores,
    scoreTotal: scoresQuery.data?.pagination.total ?? 0,
    view,
    visibleJobCount: visibleJobs.length,
  });
  const bulkVisibility = myScoresBulkVisibility(view);
  const scorePagination = scoresQuery.data?.pagination;
  const canGoPrevious = showScores && scorePagination ? scorePagination.page > 1 : false;
  const canGoNext = showScores && scorePagination
    ? scorePagination.page < scorePagination.total_pages
    : false;

  React.useEffect(() => {
    setSelectedScoreIds(new Set());
    setSelectedJobIds(new Set());
    setBatchMode(false);
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
  const toggleJobSelection = (jobId: string) => {
    setSelectedJobIds((current) => {
      const next = new Set(current);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };
  const toggleVisibleSelection = (checked: boolean) => {
    setSelectedScoreIds(checked ? new Set(scoreIds) : new Set());
    setSelectedJobIds(checked ? new Set(visibleSelectableJobIds) : new Set());
  };
  const clearSelection = () => {
    setSelectedScoreIds(new Set());
    setSelectedJobIds(new Set());
  };
  const selectedIds = () => Array.from(selectedScoreIds);
  const selectedJobs = () => Array.from(selectedJobIds);

  const navigate = (next: {
    view?: MyScoresPageView;
    search?: string | null;
    sort?: MyScoresSort;
    page?: number;
  }) => {
    router.push(buildMyScoresHref({ view, search: params.search, sort }, next));
  };
  const handleDeleteSelected = () => {
    const totalSelected = selectedCount + selectedJobCount;
    if (!totalSelected || !window.confirm(t('confirmDeleteSelected', { count: totalSelected }))) {
      return;
    }
    Promise.all([
      selectedCount ? deleteScores.mutateAsync(selectedIds()) : Promise.resolve(),
      ...selectedJobs().map((jobId) => deleteJob.mutateAsync(jobId)),
    ])
      .then(clearSelection)
      .catch(() => undefined);
  };
  const deleteSingleScore = (scoreId: string) => {
    if (!window.confirm(t('confirmDeleteSelected', { count: 1 }))) {
      return;
    }
    deleteScores.mutate([scoreId]);
  };
  const handlePublishSelected = () => {
    publishScores.mutate(selectedIds(), { onSuccess: clearSelection });
  };
  const handleUnpublishSelected = () => {
    unpublishScores.mutate(selectedIds(), { onSuccess: clearSelection });
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
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader
        title={t('title')}
        description={t('subtitle')}
        actions={
          <Button asChild>
            <Link href="/upload">
              <Upload className="mr-2 h-4 w-4" />
              {t('uploadScore')}
            </Link>
          </Button>
        }
      />
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex flex-wrap gap-2">
              {MY_SCORE_PAGE_VIEWS.map((item) => (
                <Button
                  key={item}
                  variant={item === view ? 'default' : 'outline'}
                  onClick={() => navigate({ view: item })}
                >
                  {t(`views.${item}`)}
                </Button>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              {scores.length || visibleSelectableJobIds.length ? (
                <Button variant={batchMode ? 'secondary' : 'outline'} onClick={() => {
                  setBatchMode((current) => !current);
                  clearSelection();
                  }}>
                  {batchMode ? t('cancelBatchEdit') : t('batchEdit')}
                </Button>
              ) : null}
            </div>
          </div>
          <div className="mb-5">
            <h2 className="text-2xl font-bold">{t(`views.${view}`)}</h2>
            <p className="text-sm text-muted-foreground">{t('totalScores', { count: total })}</p>
          </div>
          {!batchMode ? (
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
          ) : (scores.length || visibleSelectableJobIds.length) ? (
            <MyScoresBulkActions
              selectedCount={selectedCount}
              selectedJobCount={selectedJobCount}
              allSelected={allVisibleSelected}
              publishPending={publishScores.isPending}
              unpublishPending={unpublishScores.isPending}
              deletePending={deleteScores.isPending || deleteJob.isPending}
              showPublishAction={bulkVisibility.publish}
              showUnpublishAction={bulkVisibility.unpublish}
              onToggleSelectAll={toggleVisibleSelection}
              onPublishSelected={handlePublishSelected}
              onUnpublishSelected={handleUnpublishSelected}
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
                <ImportJobCard
                  key={job.job_id}
                  job={job}
                  deletePending={deleteJob.isPending}
                  batchMode={batchMode}
                  selected={selectedJobIds.has(job.job_id)}
                  onOpenScore={() => router.push(
                    job.state === 'PENDING_REVIEW'
                      ? `/review/${encodeURIComponent(job.job_id)}`
                      : `/upload?job_id=${encodeURIComponent(job.job_id)}`
                  )}
                  onToggleSelection={() => toggleJobSelection(job.job_id)}
                  onDismiss={() => deleteJob.mutate(job.job_id)}
                  t={t}
                />
              ))}
              {showScores ? scores.map((score) => (
                <MyScoreCard
                  key={score.score_id}
                  score={score}
                  view={scoreView}
                  batchMode={batchMode}
                  selected={selectedScoreIds.has(score.score_id)}
                  onOpen={() =>
                    router.push(`/score/${score.score_id}?from=my-scores`)
                  }
                  onToggleSelection={() => toggleScoreSelection(score.score_id)}
                  onDelete={() => deleteSingleScore(score.score_id)}
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
  );
}

