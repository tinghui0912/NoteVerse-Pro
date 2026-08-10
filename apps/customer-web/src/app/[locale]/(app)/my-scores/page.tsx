'use client';

import React from 'react';
import { Music, Upload } from 'lucide-react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { SectionLoading } from '@/components/loading';
import { EmptyState } from '@/components/states';
import { SectionErrorState } from '@/components/states';
import { MyScoresBulkActions } from '@/components/my-scores/my-scores-bulk-actions';
import { MyScoresFilterBar } from '@/components/my-scores/my-scores-filter-bar';
import { MyScoresPagination } from '@/components/my-scores/my-scores-pagination';
import { MyScoreCard } from '@/components/my-scores/my-score-card';
import { ImportJobCard } from '@/components/my-scores/import-job-card';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { PageHeader } from '@/components/page';
import { useDeleteImportJob, useImportJobList } from '@/hooks/queries/use-import-job-queries';
import {
  useAddMyScoresToLibrary,
  useDeleteMyScores,
  useMyScores,
  usePublishMyScores,
  useUnpublishMyScores,
} from '@/hooks/queries/use-my-scores-queries';
import {
  buildMyScoresHref,
  isMyScoreView,
  MY_SCORE_PAGE_VIEWS,
  type MyScoresPageView,
  myScoresBulkVisibility,
  myScoresTotal,
  normalizeMyScoresSort,
  normalizeMyScoresView,
  normalizePage,
  scoreBackedView,
  visibleMyScoreJobs,
} from '@/lib/my-scores/state';
import { userFacingErrorMessage } from '@/lib/i18n/error-message';
import type { MyScoresSort } from '@/generated/api';

type DeleteTarget = {
  scoreIds: string[];
  jobIds: string[];
} | null;

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
  const common = useTranslations('common');
  const errors = useTranslations('errors');
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
  const addScoresToLibrary = useAddMyScoresToLibrary();
  const deleteScores = useDeleteMyScores();
  const publishScores = usePublishMyScores();
  const unpublishScores = useUnpublishMyScores();
  const scores = React.useMemo(() => scoresQuery.data?.data ?? [], [scoresQuery.data?.data]);
  const jobs = React.useMemo(() => jobsQuery.data?.data ?? [], [jobsQuery.data?.data]);
  const [batchMode, setBatchMode] = React.useState(false);
  const [selectedScoreIds, setSelectedScoreIds] = React.useState<Set<string>>(new Set());
  const [selectedJobIds, setSelectedJobIds] = React.useState<Set<string>>(new Set());
  const [deleteTarget, setDeleteTarget] = React.useState<DeleteTarget>(null);
  const selectedCount = selectedScoreIds.size;
  const selectedJobCount = selectedJobIds.size;
  const scoreIds = React.useMemo(() => scores.map((score) => score.score_id), [scores]);
  const selectedScoresNotInLibrary = React.useMemo(
    () =>
      scores
        .filter((score) => selectedScoreIds.has(score.score_id) && !score.in_library)
        .map((score) => score.score_id),
    [scores, selectedScoreIds]
  );
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
  const deleteTargetCount = (deleteTarget?.scoreIds.length ?? 0) + (deleteTarget?.jobIds.length ?? 0);

  const navigate = (next: {
    view?: MyScoresPageView;
    search?: string | null;
    sort?: MyScoresSort;
    page?: number;
  }) => {
    router.push(buildMyScoresHref({ view, search: params.search, sort }, next));
  };
  const handleDeleteSelected = () => {
    if (selectedCount + selectedJobCount === 0) return;
    setDeleteTarget({ scoreIds: selectedIds(), jobIds: selectedJobs() });
  };
  const handleAddToLibrarySelected = () => {
    if (!selectedScoresNotInLibrary.length) return;
    addScoresToLibrary.mutate(selectedScoresNotInLibrary, { onSuccess: clearSelection });
  };
  const addSingleScoreToLibrary = (scoreId: string) => {
    addScoresToLibrary.mutate([scoreId]);
  };
  const confirmDeleteTarget = () => {
    if (!deleteTarget || deleteTargetCount === 0) return;
    Promise.all([
      deleteTarget.scoreIds.length ? deleteScores.mutateAsync(deleteTarget.scoreIds) : Promise.resolve(),
      ...deleteTarget.jobIds.map((jobId) => deleteJob.mutateAsync(jobId)),
    ])
      .then(() => {
        clearSelection();
        setDeleteTarget(null);
      })
      .catch(() => undefined);
  };
  const deleteSingleScore = (scoreId: string) => {
    setDeleteTarget({ scoreIds: [scoreId], jobIds: [] });
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
  const loadErrorMessage = userFacingErrorMessage(errors, loadError, t('loadFailedDesc'));

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
              addToLibraryPending={addScoresToLibrary.isPending}
              deletePending={deleteScores.isPending || deleteJob.isPending}
              addToLibraryCount={selectedScoresNotInLibrary.length}
              showPublishAction={bulkVisibility.publish}
              showUnpublishAction={bulkVisibility.unpublish}
              onToggleSelectAll={toggleVisibleSelection}
              onAddToLibrarySelected={handleAddToLibrarySelected}
              onPublishSelected={handlePublishSelected}
              onUnpublishSelected={handleUnpublishSelected}
              onDeleteSelected={handleDeleteSelected}
              t={t}
            />
          ) : null}
          {isLoading ? (
            <SectionLoading label={t('loading')} className="py-20" />
          ) : isError ? (
            <SectionErrorState
              title={t('loadFailed')}
              description={loadErrorMessage}
            />
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
                  onDismiss={() => setDeleteTarget({ scoreIds: [], jobIds: [job.job_id] })}
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
                  onAddToLibrary={() => addSingleScoreToLibrary(score.score_id)}
                  onDelete={() => deleteSingleScore(score.score_id)}
                  t={t}
                />
              )) : null}
            </div>
          ) : (
            <Card className="rounded-2xl">
              <CardContent>
                <EmptyState
                  icon={Music}
                  title={params.search ? t('emptySearch') : t(`empty.${view}`)}
                  className="py-20"
                  action={
                    <Button asChild>
                      <Link href="/upload">{t('uploadScore')}</Link>
                    </Button>
                  }
                />
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
          <AlertDialog
            open={deleteTarget !== null}
            onOpenChange={(open) => {
              if (!open) setDeleteTarget(null);
            }}
          >
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>{t('deleteDialogTitle')}</AlertDialogTitle>
                <AlertDialogDescription>
                  {t('deleteDialogDescription', { count: deleteTargetCount })}
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>{common('cancel')}</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  disabled={deleteScores.isPending || deleteJob.isPending || deleteTargetCount === 0}
                  onClick={confirmDeleteTarget}
                >
                  {t('deleteDialogConfirm')}
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
    </div>
  );
}

