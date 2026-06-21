'use client';

import { useTranslations } from 'next-intl';
import { useBackendMessage } from '@/hooks/use-backend-message';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChevronRight, Eye, Loader2, Music } from 'lucide-react';
import { cn } from '@/lib/utils';
import React, { useMemo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { useRouter } from 'next/navigation';
import { Footer } from '@/components/layout/footer';
import type { Task } from '@/types/api';
import { useTaskList } from '@/hooks/queries/use-task-queries';
import { useSavedShares } from '@/hooks/queries/use-share-queries';
import { HistoryPagination } from '@/components/history/history-pagination';
import { HistoryScoreCard } from '@/components/history/history-score-card';
import { HistoryStatusIndicator } from '@/components/history/history-status-indicator';
import { HistoryToolbar } from '@/components/history/history-toolbar';
import {
  getTaskLink,
  mapStatusToTaskState,
  mapTaskStateToStatus,
  type HistoryTab,
  type ShareHistoryItem,
  type TaskHistoryItem,
} from '@/components/history/history-types';
import { useHistorySelection } from '@/hooks/history/use-history-selection';
import { useHistoryThumbnails } from '@/hooks/history/use-history-thumbnails';
import { useHistoryViewState } from '@/hooks/history/use-history-view-state';
import { useHistoryBatchActions } from '@/hooks/history/use-history-batch-actions';

export default function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const { tab } = React.use(searchParams);
  const initialTab: HistoryTab = tab === 'shares' ? 'shares' : 'uploads';
  const t = useTranslations('history');
  const tCommon = useTranslations('common');
  const backendMessage = useBackendMessage();
  const router = useRouter();

  const historyState = useHistoryViewState(initialTab);
  const { activeTab, activeState, uploads, shares: sharesState } = historyState;
  const uploadsPageSize = uploads.view === 'list' ? 10 : 6;
  const sharesPageSize = sharesState.view === 'list' ? 10 : 6;

  const stateFilter = mapStatusToTaskState(uploads.statusFilter);

  // 1. TanStack Query锛氫换鍔″垪琛ㄦ煡璇?
  const { data: tasksResponse, isLoading: isTasksLoading } = useTaskList(
    { page: uploads.page, pageSize: uploadsPageSize, state: stateFilter, sortBy: uploads.sortBy, sortOrder: uploads.sortOrder, search: uploads.searchQuery || undefined },
    { refetchInterval: activeTab === 'uploads' && uploads.statusFilter === 'all' ? 5000 : false }
  );

  const taskThumbnailRequests = useMemo(
    () => (tasksResponse?.data ?? []).map((task) => ({ key: task.task_id, taskId: task.task_id, thumbnailType: task.thumbnail_type })),
    [tasksResponse?.data]
  );
  const taskThumbnails = useHistoryThumbnails(taskThumbnailRequests);

  const tasks = useMemo<TaskHistoryItem[]>(() => {
    return (tasksResponse?.data ?? []).map((task: Task) => ({
      id: task.task_id,
      name: task.title || t('taskLabel', { id: task.task_id.slice(0, 8) }),
      date: task.created_at || new Date().toISOString(),
      status: mapTaskStateToStatus(task.state),
      thumbnail: taskThumbnails[task.task_id]?.url ?? '',
      thumbnailType: task.thumbnail_type,
      thumbnailError: taskThumbnails[task.task_id]?.error,
    }));
  }, [tasksResponse?.data, t, taskThumbnails]);

  // 2. TanStack Query锛氭敹钘忓垪琛ㄦ煡璇?
  const { data: sharesResponse, isLoading: isSharesLoading } = useSavedShares({
    page: sharesState.page,
    pageSize: sharesPageSize,
    sortBy: sharesState.sortBy,
    sortOrder: sharesState.sortOrder,
    search: sharesState.searchQuery || undefined,
  });

  const shareThumbnailRequests = useMemo(
    () => (sharesResponse?.data ?? []).map((item) => ({ key: String(item.id), taskId: item.task_id, thumbnailType: item.thumbnail_type })),
    [sharesResponse?.data]
  );
  const shareThumbnails = useHistoryThumbnails(shareThumbnailRequests);

  const shares = useMemo<ShareHistoryItem[]>(() => {
    return (sharesResponse?.data ?? []).map((item) => ({
      id: item.id,
      name: item.task_title,
      sharedBy: item.shared_by || backendMessage('anonymous'),
      date: item.created_at,
      thumbnail: shareThumbnails[String(item.id)]?.url ?? '',
      taskId: item.task_id,
      thumbnailType: item.thumbnail_type,
      shareToken: item.share_token,
      thumbnailError: shareThumbnails[String(item.id)]?.error,
    }));
  }, [backendMessage, sharesResponse?.data, shareThumbnails]);

  const currentPageIds = activeTab === 'uploads'
    ? tasks.map((item) => item.id)
    : shares.map((item) => String(item.id));
  const selection = useHistorySelection(currentPageIds);
  const { selectedItems, selectionMode } = selection;

  const isLoading = activeTab === 'uploads' ? isTasksLoading : isSharesLoading;
  const batchActions = useHistoryBatchActions({
    activeTab,
    selectedItems,
    shares,
    onComplete: selection.clear,
  });

  const totalTasks = tasksResponse?.pagination?.total ?? tasks.length;
  const totalShares = sharesResponse?.pagination?.total ?? shares.length;
  const uploadsPageCount = Math.ceil(totalTasks / uploadsPageSize);
  const sharesPageCount = Math.ceil(totalShares / sharesPageSize);

  const handleTabChange = (value: string) => {
    selection.clear();
    const nextTab = value as HistoryTab;
    historyState.setActiveTab(nextTab);
    router.replace(`/history?tab=${nextTab}`);
  };

  const handleRowClick = (item: TaskHistoryItem | ShareHistoryItem, isUpload: boolean) => {
    const itemId = isUpload ? (item as TaskHistoryItem).id : String((item as ShareHistoryItem).id);
    if (selectionMode) {
      selection.toggleItem(itemId);
    } else {
      if (isUpload) {
        const link = getTaskLink(item as TaskHistoryItem);
        router.push(link);
      } else {
        const shareItem = item as ShareHistoryItem;
        if (shareItem.shareToken) {
          router.push(`/share/${shareItem.shareToken}`);
        }
      }
    }
  };

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col">
      <div className="bg-gray-900">
        <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
          <p className="text-lg text-gray-300">{t('subtitle')}</p>
        </div>
      </div>

      <main className="grow">
        <div className="max-w-7xl mx-auto px-4 py-16">
          <Tabs value={activeTab} className="w-full" onValueChange={handleTabChange}>
            <TabsList className="grid w-full grid-cols-2 bg-gray-200 rounded-full h-auto p-1 mb-4 max-w-md mx-auto">
              <TabsTrigger value="uploads" className="rounded-full data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:shadow-md py-2">{t('myUploads')}</TabsTrigger>
              <TabsTrigger value="shares" className="rounded-full data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:shadow-md py-2">{t('savedShares')}</TabsTrigger>
            </TabsList>
            <Card className="bg-white p-6 rounded-2xl shadow-lg">
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
                  <HistoryToolbar
                    activeTab={activeTab}
                    searchQuery={activeState.searchQuery}
                    sortBy={activeState.sortBy}
                    sortOrder={activeState.sortOrder}
                    statusFilter={uploads.statusFilter}
                    view={activeState.view}
                    selectionMode={selectionMode}
                    selectedCount={selectedItems.length}
                    isAllSelected={selection.isAllSelected}
                    isDeleting={batchActions.isDeleting}
                    isDownloading={batchActions.isDownloading}
                    onSearchChange={historyState.setSearchQuery}
                    onSortChange={historyState.setSort}
                    onStatusChange={historyState.setStatusFilter}
                    onViewChange={historyState.setView}
                    onSelectAll={selection.selectAll}
                    onToggleSelection={selection.toggleMode}
                    onBatchDelete={batchActions.deleteSelected}
                    onBatchDownload={batchActions.downloadSelected}
                  />
                </div>

                <TabsContent value="uploads">
                  {isLoading ? (
                    <div className="flex items-center justify-center py-20">
                      <Loader2 className="h-8 w-8 animate-spin text-primary" />
                      <span className="ml-2 text-muted-foreground">{tCommon('loading')}</span>
                    </div>
                  ) : tasks.length === 0 ? (
                    <div className="text-center py-20">
                      <Music className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                      <p className="text-lg text-muted-foreground">{t('noTasks')}</p>
                      <Button className="mt-4" onClick={() => router.push('/upload')}>
                        {t('uploadScore')}
                      </Button>
                    </div>
                  ) : uploads.view === 'list' ? (
                    <div className="space-y-2">
                      {tasks.map(item => {
                        const isSelected = selectedItems.includes(item.id);
                        return (
                          <div
                            key={item.id}
                            className={cn(
                              "p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between gap-4 w-full",
                              isSelected && "bg-muted/50 ring-2 ring-ring",
                              "cursor-pointer"
                            )}
                            onClick={() => handleRowClick(item, true)}
                          >
                            <div className="flex items-center gap-4 flex-1 min-w-0">
                              {selectionMode && (
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => selection.toggleItem(item.id)}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-5 w-5"
                                />
                              )}
                              <Music className="h-6 w-6 text-primary" />
                              <div className="truncate">
                                <h3 className="font-semibold truncate">{item.name}</h3>
                                <p className="text-sm text-muted-foreground">{item.date}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 shrink-0">
                              <HistoryStatusIndicator status={item.status} />
                              {!selectionMode && (
                                <div className="p-1 -m-1">
                                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      {tasks.map(item => (
                        <HistoryScoreCard
                          key={item.id}
                          item={item}
                          isSelected={selectedItems.includes(item.id)}
                          onSelect={selection.toggleItem}
                          onOpen={() => router.push(getTaskLink(item))}
                          selectionMode={selectionMode}
                          isUpload={true}
                        />
                      ))}
                    </div>
                  )}
                  <HistoryPagination currentPage={uploads.page} pageCount={uploadsPageCount} onPageChange={(page) => historyState.setPage('uploads', page)} />
                </TabsContent>

                <TabsContent value="shares">
                  {shares.length === 0 ? (
                    <div className="text-center py-20">
                      <Eye className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                      <p className="text-lg text-muted-foreground">{t('noShares')}</p>
                    </div>
                  ) : sharesState.view === 'list' ? (
                    <div className="space-y-2">
                      {shares.map(item => {
                        const isSelected = selectedItems.includes(String(item.id));
                        return (
                          <div
                            key={item.id}
                            className={cn("p-3 rounded-lg bg-gray-50 hover:bg-gray-100 transition-colors flex items-center justify-between gap-4 w-full",
                              isSelected && "bg-muted/50 ring-2 ring-ring",
                              "cursor-pointer"
                            )}
                            onClick={() => handleRowClick(item, false)}
                          >
                            <div className="flex items-center gap-4 flex-1 min-w-0">
                              {selectionMode && (
                                <Checkbox
                                  checked={isSelected}
                                  onCheckedChange={() => selection.toggleItem(String(item.id))}
                                  onClick={(e) => e.stopPropagation()}
                                  className="h-5 w-5"
                                />
                              )}
                              <Music className="h-6 w-6 text-primary" />
                              <div className="truncate">
                                <h3 className="font-semibold truncate">{item.name}</h3>
                                <p className="text-sm text-muted-foreground">{t('sharedByAt', { by: item.sharedBy, date: item.date })}</p>
                              </div>
                            </div>
                            <div className="flex items-center gap-4 shrink-0">
                              <div className="flex items-center text-sm font-medium text-primary">
                                <Eye className="mr-2 h-4 w-4" />
                                <span>{tCommon('view')}</span>
                              </div>
                              {!selectionMode && (
                                <div className="p-1 -m-1">
                                  <ChevronRight className="h-5 w-5 text-muted-foreground" />
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                      {shares.map(item => (
                        <HistoryScoreCard
                          key={item.id}
                          item={item}
                          isSelected={selectedItems.includes(String(item.id))}
                          onSelect={selection.toggleItem}
                          onOpen={() => item.shareToken && router.push(`/share/${item.shareToken}`)}
                          selectionMode={selectionMode}
                          isUpload={false}
                        />
                      ))}
                    </div>
                  )}
                  <HistoryPagination currentPage={sharesState.page} pageCount={sharesPageCount} onPageChange={(page) => historyState.setPage('shares', page)} />
                </TabsContent>
              </CardContent>
            </Card>
          </Tabs>
        </div>
      </main>
      <Footer />
    </div>
  );
}
