'use client';

import React, { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { ChevronRight, Eye, Loader2, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Footer } from '@/components/layout/footer';
import { HistoryPagination } from '@/components/history/history-pagination';
import { HistoryScoreCard } from '@/components/history/history-score-card';
import { HistoryStatusIndicator } from '@/components/history/history-status-indicator';
import { HistoryToolbar } from '@/components/history/history-toolbar';
import {
  getHistoryLink,
  mapJobStateToStatus,
  mapScoreStateToStatus,
  type HistoryTab,
  type ShareHistoryItem,
  type TaskHistoryItem,
} from '@/components/history/history-types';
import { useHistoryBatchActions } from '@/hooks/history/use-history-batch-actions';
import { useHistorySelection } from '@/hooks/history/use-history-selection';
import { useHistoryViewState } from '@/hooks/history/use-history-view-state';
import { useJobList } from '@/hooks/queries/use-job-queries';
import { useScoreBookmarks, useScoreList } from '@/hooks/queries/use-score-queries';
import { cn } from '@/lib/utils';

export default function HistoryPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const { tab } = React.use(searchParams);
  const initialTab: HistoryTab = tab === 'shares' ? 'shares' : 'uploads';
  const t = useTranslations('history');
  const common = useTranslations('common');
  const router = useRouter();
  const historyState = useHistoryViewState(initialTab);
  const { activeTab, activeState, uploads: uploadState, shares: shareState } = historyState;
  const pageSize = uploadState.view === 'list' ? 10 : 6;
  const scoreQuery = useScoreList(uploadState.page, pageSize, uploadState.searchQuery || undefined);
  const jobQuery = useJobList(uploadState.page, pageSize, activeTab === 'uploads');
  const bookmarkQuery = useScoreBookmarks();

  const uploadItems = useMemo<TaskHistoryItem[]>(() => {
    const scores = (scoreQuery.data?.data ?? []).map((score) => ({
      id: score.score_id,
      selectionId: `score:${score.score_id}`,
      entity: 'score' as const,
      name: score.title || t('taskLabel', { id: score.score_id.slice(0, 8) }),
      date: score.updated_at,
      status: mapScoreStateToStatus(score.state),
      thumbnail: '',
      thumbnailError: true,
      headRevisionId: score.head_revision_id,
    }));
    const jobs = (jobQuery.data?.data ?? [])
      .filter((job) => !job.score_id)
      .map((job) => ({
        id: job.job_id,
        selectionId: `job:${job.job_id}`,
        entity: 'job' as const,
        name: job.title || t('taskLabel', { id: job.job_id.slice(0, 8) }),
        date: job.updated_at || job.created_at || new Date().toISOString(),
        status: mapJobStateToStatus(job.state),
        thumbnail: '',
        thumbnailError: true,
      }));
    const status = uploadState.statusFilter;
    return [...jobs, ...scores]
      .filter((item) => status === 'all' || item.status === status)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }, [jobQuery.data?.data, scoreQuery.data?.data, t, uploadState.statusFilter]);

  const bookmarkItems = useMemo<ShareHistoryItem[]>(() =>
    (bookmarkQuery.data?.data ?? []).map((bookmark) => ({
      id: bookmark.bookmark_id,
      selectionId: `bookmark:${bookmark.bookmark_id}`,
      name: bookmark.title,
      sharedBy: '',
      date: bookmark.created_at,
      thumbnail: '',
      thumbnailError: true,
      scoreId: bookmark.score_id,
      available: bookmark.available,
    })), [bookmarkQuery.data?.data]);

  const currentIds = activeTab === 'uploads'
    ? uploadItems.map((item) => item.selectionId)
    : bookmarkItems.map((item) => item.selectionId);
  const selection = useHistorySelection(currentIds);
  const batch = useHistoryBatchActions({
    activeTab,
    selectedItems: selection.selectedItems,
    uploads: uploadItems,
    onComplete: selection.clear,
  });
  const isLoading = activeTab === 'uploads'
    ? scoreQuery.isLoading || jobQuery.isLoading
    : bookmarkQuery.isLoading;
  const totalUploads = (scoreQuery.data?.pagination.total ?? 0) +
    (jobQuery.data?.pagination.total ?? 0);
  const uploadPages = Math.max(1, Math.ceil(totalUploads / pageSize));

  const handleTabChange = (value: string) => {
    selection.clear();
    historyState.setActiveTab(value as HistoryTab);
    router.replace(`/history?tab=${value}`);
  };
  const openUpload = (item: TaskHistoryItem) => {
    if (selection.selectionMode) selection.toggleItem(item.selectionId);
    else router.push(getHistoryLink(item));
  };
  const openBookmark = (item: ShareHistoryItem) => {
    if (selection.selectionMode) selection.toggleItem(item.selectionId);
    else if (item.available) router.push(`/results/${item.scoreId}?from=shares`);
  };

  const renderList = (items: Array<TaskHistoryItem | ShareHistoryItem>, uploads: boolean) => (
    <div className="space-y-2">
      {items.map((item) => {
        const selected = selection.selectedItems.includes(item.selectionId);
        const disabled = !uploads && !(item as ShareHistoryItem).available;
        return (
          <div
            key={item.selectionId}
            className={cn(
              'flex w-full items-center justify-between gap-4 rounded-lg bg-gray-50 p-3 transition-colors',
              selected && 'bg-muted/50 ring-2 ring-ring',
              disabled ? 'cursor-not-allowed opacity-60' : 'cursor-pointer hover:bg-gray-100'
            )}
            onClick={() => uploads ? openUpload(item as TaskHistoryItem) : openBookmark(item as ShareHistoryItem)}
          >
            <div className="flex min-w-0 flex-1 items-center gap-4">
              {selection.selectionMode ? <Checkbox checked={selected} onCheckedChange={() => selection.toggleItem(item.selectionId)} onClick={(event) => event.stopPropagation()} className="h-5 w-5" /> : null}
              <Music className="h-6 w-6 text-primary" />
              <div className="truncate"><h3 className="truncate font-semibold">{item.name}</h3><p className="text-sm text-muted-foreground">{item.date}</p></div>
            </div>
            <div className="flex shrink-0 items-center gap-4">
              {uploads ? <HistoryStatusIndicator status={(item as TaskHistoryItem).status} /> : <Eye className="h-4 w-4 text-primary" />}
              {!selection.selectionMode ? <ChevronRight className="h-5 w-5 text-muted-foreground" /> : null}
            </div>
          </div>
        );
      })}
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-gray-50">
      <div className="bg-gray-900"><div className="mx-auto max-w-7xl px-4 pb-16 pt-32 text-center"><h1 className="mb-4 text-4xl font-bold text-white sm:text-6xl">{t('title')}</h1><p className="text-lg text-gray-300">{t('subtitle')}</p></div></div>
      <main className="grow"><div className="mx-auto max-w-7xl px-4 py-16">
        <Tabs value={activeTab} className="w-full" onValueChange={handleTabChange}>
          <TabsList className="mx-auto mb-4 grid h-auto w-full max-w-md grid-cols-2 rounded-full bg-gray-200 p-1"><TabsTrigger value="uploads" className="rounded-full py-2">{t('myUploads')}</TabsTrigger><TabsTrigger value="shares" className="rounded-full py-2">{t('savedShares')}</TabsTrigger></TabsList>
          <Card className="rounded-2xl bg-white p-6 shadow-lg"><CardContent className="p-0">
            <div className="mb-6"><HistoryToolbar activeTab={activeTab} searchQuery={activeState.searchQuery} sortBy={activeState.sortBy} sortOrder={activeState.sortOrder} statusFilter={uploadState.statusFilter} view={activeState.view} selectionMode={selection.selectionMode} selectedCount={selection.selectedItems.length} isAllSelected={selection.isAllSelected} isDeleting={batch.isDeleting} isDownloading={batch.isDownloading} onSearchChange={historyState.setSearchQuery} onSortChange={historyState.setSort} onStatusChange={historyState.setStatusFilter} onViewChange={historyState.setView} onSelectAll={selection.selectAll} onToggleSelection={selection.toggleMode} onBatchDelete={batch.deleteSelected} onBatchDownload={batch.downloadSelected} /></div>
            {isLoading ? <div className="flex items-center justify-center py-20"><Loader2 className="h-8 w-8 animate-spin text-primary" /><span className="ml-2 text-muted-foreground">{common('loading')}</span></div> : null}
            <TabsContent value="uploads">
              {!isLoading && uploadItems.length === 0 ? <div className="py-20 text-center"><Music className="mx-auto mb-4 h-16 w-16 text-muted-foreground" /><p className="text-lg text-muted-foreground">{t('noTasks')}</p><Button className="mt-4" onClick={() => router.push('/upload')}>{t('uploadScore')}</Button></div> : uploadState.view === 'list' ? renderList(uploadItems, true) : <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">{uploadItems.map((item) => <HistoryScoreCard key={item.selectionId} item={item} isSelected={selection.selectedItems.includes(item.selectionId)} onSelect={selection.toggleItem} onOpen={() => openUpload(item)} selectionMode={selection.selectionMode} isUpload />)}</div>}
              <HistoryPagination currentPage={uploadState.page} pageCount={uploadPages} onPageChange={(page) => historyState.setPage('uploads', page)} />
            </TabsContent>
            <TabsContent value="shares">
              {!isLoading && bookmarkItems.length === 0 ? <div className="py-20 text-center"><Eye className="mx-auto mb-4 h-16 w-16 text-muted-foreground" /><p className="text-lg text-muted-foreground">{t('noShares')}</p></div> : shareState.view === 'list' ? renderList(bookmarkItems, false) : <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">{bookmarkItems.map((item) => <HistoryScoreCard key={item.selectionId} item={item} isSelected={selection.selectedItems.includes(item.selectionId)} onSelect={selection.toggleItem} onOpen={() => openBookmark(item)} selectionMode={selection.selectionMode} isUpload={false} />)}</div>}
            </TabsContent>
          </CardContent></Card>
        </Tabs>
      </div></main>
      <Footer />
    </div>
  );
}
