import type { ImportJobRead, MyScoresSort, MyScoresView } from '@/generated/api';

export type MyScoresPageView = MyScoresView | 'importing' | 'review' | 'failed';

export const MY_SCORE_VIEWS: MyScoresView[] = [
  'all',
  'private',
  'published',
];

export const MY_SCORE_PAGE_VIEWS: MyScoresPageView[] = [
  'all',
  'importing',
  'review',
  'failed',
  'private',
  'published',
];

export function normalizeMyScoresView(value?: string): MyScoresPageView {
  return MY_SCORE_PAGE_VIEWS.includes(value as MyScoresPageView)
    ? (value as MyScoresPageView)
    : 'all';
}

export function normalizeMyScoresSort(value?: string): MyScoresSort {
  return value === 'name_asc' ? 'name_asc' : 'updated_desc';
}

export function normalizePage(value?: string): number {
  const page = Number(value ?? 1);
  return Number.isFinite(page) ? Math.max(1, page) : 1;
}

export function isMyScoreView(view: MyScoresPageView): view is MyScoresView {
  return MY_SCORE_VIEWS.includes(view as MyScoresView);
}

export function scoreBackedView(view: MyScoresPageView): MyScoresView {
  return isMyScoreView(view) ? view : 'all';
}

export function isImportJob(job: ImportJobRead) {
  return job.state === 'PENDING' || job.state === 'RUNNING';
}

export function visibleMyScoreJobs(jobs: ImportJobRead[], view: MyScoresPageView) {
  return jobs.filter((job) => {
    if (view === 'importing') return isImportJob(job);
    if (view === 'review') return job.state === 'PENDING_REVIEW';
    if (view === 'failed') return job.state === 'FAILURE';
    if (view === 'all') return isImportJob(job) || job.state === 'PENDING_REVIEW' || job.state === 'FAILURE';
    return false;
  });
}

export function myScoresTotal(params: {
  showScores: boolean;
  scoreTotal: number;
  view: MyScoresPageView;
  visibleJobCount: number;
}) {
  if (!params.showScores) return params.visibleJobCount;
  return params.scoreTotal + (params.view === 'all' ? params.visibleJobCount : 0);
}

export function myScoresBulkVisibility(view: MyScoresPageView) {
  return {
    publish: view === 'private',
    unpublish: view === 'published',
  };
}

export function buildMyScoresHref(
  current: {
    view: MyScoresPageView;
    search?: string;
    sort: MyScoresSort;
  },
  next: {
    view?: MyScoresPageView;
    search?: string | null;
    sort?: MyScoresSort;
    page?: number;
  }
) {
  const query = new URLSearchParams();
  query.set('view', next.view ?? current.view);
  const nextSearch = next.search === undefined ? current.search : next.search;
  const nextSort = next.sort ?? current.sort;
  if (nextSearch) query.set('search', nextSearch);
  if (nextSort !== 'updated_desc') query.set('sort', nextSort);
  if (next.page && next.page > 1) query.set('page', String(next.page));
  return `/my-scores?${query.toString()}`;
}
