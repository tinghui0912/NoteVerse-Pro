'use client';

import { useTranslations } from 'next-intl';
import { useBackendMessage } from '@/hooks/use-backend-message';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Music, Search, CheckCircle2, XCircle, Clock, LoaderCircle, ChevronRight, Eye, List, LayoutGrid, Trash2, Download, Edit, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useMemo, useEffect, useCallback } from 'react';
import Image from 'next/image';
import { placeholderImages } from '@/lib/placeholder-images';
import { fetchAuthenticatedImage } from '@/lib/utils/image';
import { Checkbox } from '@/components/ui/checkbox';
import { useRouter } from 'next/navigation';
import { Footer } from '@/components/layout/footer';
import { tasksApi, filesApi, sharesApi } from '@/lib/api';
import type { Task, TaskState } from '@/types/api';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';

type UploadStatus = 'completed' | 'pending-review' | 'in-progress' | 'queued' | 'failed';

// 将 TaskState 转换为 UploadStatus
const mapTaskStateToStatus = (state: TaskState): UploadStatus => {
  switch (state) {
    case 'SUCCESS': return 'completed';
    case 'PENDING_REVIEW': return 'pending-review';
    case 'PROGRESS': return 'in-progress';
    case 'PENDING': return 'queued';
    case 'FAILURE': return 'failed';
    default: return 'queued';
  }
};

// 将 UploadStatus 转换回 TaskState
const mapStatusToTaskState = (status: string): TaskState | undefined => {
  switch (status) {
    case 'completed': return 'SUCCESS';
    case 'pending-review': return 'PENDING_REVIEW';
    case 'in-progress': return 'PROGRESS';
    case 'queued': return 'PENDING';
    case 'failed': return 'FAILURE';
    default: return undefined;
  }
};

interface TaskItem {
  id: string;
  name: string;
  date: string;
  status: UploadStatus;
  thumbnail: string;
  thumbnailType?: string;
  thumbnailError?: boolean; // 图片加载失败标记
}

interface ShareItem {
  id: number;
  name: string;
  sharedBy: string;
  date: string;
  thumbnail: string;
  taskId?: string;  // 用于加载缩略图
  thumbnailType?: string;  // 缩略图类型
  shareToken?: string;  // 用于跳转到分享页
}

const statusConfig: Record<UploadStatus, { labelKey: string; icon: React.ElementType; color: string; animation?: string }> = {
  completed: { labelKey: 'statusCompleted', icon: CheckCircle2, color: 'text-green-500' },
  'pending-review': { labelKey: 'statusPendingReview', icon: Clock, color: 'text-orange-500' },
  'in-progress': { labelKey: 'statusInProgress', icon: LoaderCircle, color: 'text-blue-500', animation: 'animate-spin' },
  queued: { labelKey: 'statusQueued', icon: Clock, color: 'text-yellow-500' },
  failed: { labelKey: 'statusFailed', icon: XCircle, color: 'text-red-500' },
};

// 根据任务状态决定跳转目标
const getTaskLink = (item: TaskItem): string => {
  // 排队中/进行中/失败 → /upload?task_id=xxx
  if (item.status === 'queued' || item.status === 'in-progress' || item.status === 'failed') {
    return `/upload?task_id=${item.id}`;
  }

  // 待审核 → /review
  if (item.status === 'pending-review') {
    return `/review/${item.id}`;
  }

  // 已完成 (SUCCESS) → /results
  return `/results/${item.id}`;
};

const StatusIndicator = ({ status, className }: { status: UploadStatus, className?: string }) => {
  const t = useTranslations('history');
  const tCommon = useTranslations('common');
  const tb = useBackendMessage();
  const config = statusConfig[status];
  return (
    <div className={cn('flex items-center text-sm font-medium', config.color, className)}>
      <config.icon className={cn('mr-2 h-4 w-4', config.animation)} />
      <span>{t(config.labelKey as any)}</span>
    </div>
  );
};

const ScoreCard = ({ item, isSelected, onSelect, selectionMode, isUpload }: {
  item: TaskItem | ShareItem;
  isSelected: boolean;
  onSelect: (id: string) => void;
  selectionMode: boolean;
  isUpload: boolean;
}) => {
  const router = useRouter();
  const t = useTranslations('history');
  const tCommon = useTranslations('common');
  const tResults = useTranslations('results');
  const tb = useBackendMessage();

  const handleCardClick = () => {
    const itemId = isUpload ? (item as TaskItem).id : String((item as ShareItem).id);
    if (selectionMode) {
      onSelect(itemId);
    } else {
      if (isUpload) {
        const link = getTaskLink(item as TaskItem);
        router.push(link);
      } else {
        const shareItem = item as ShareItem;
        if (shareItem.shareToken) {
          router.push(`/share/${shareItem.shareToken}`);
        }
      }
    }
  };

  const itemId = isUpload ? (item as TaskItem).id : String((item as ShareItem).id);

  return (
    <Card
      className={cn("bg-white rounded-2xl overflow-hidden h-full flex flex-col transition-all duration-300 hover:shadow-xl hover:-translate-y-1 relative group",
        isSelected && "ring-2 ring-ring ring-offset-2 ring-offset-background",
        "cursor-pointer"
      )}
      onClick={handleCardClick}
    >
      <div className={cn("absolute top-3 left-3 z-10", !selectionMode && "hidden")}>
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => onSelect(isUpload ? (item as TaskItem).id : String((item as ShareItem).id))}
          className={cn("h-5 w-5 bg-white/80 backdrop-blur-sm transition-opacity")}
          onClick={(e) => e.stopPropagation()}
        />
      </div>
      <div className="relative aspect-[4/3] bg-gray-100">
        {item.thumbnail ? (
          <Image src={item.thumbnail} alt={item.name} fill className="object-cover transition-transform duration-300 group-hover:scale-105" />
        ) : (item as TaskItem).thumbnailError ? (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="flex flex-col items-center">
              <Music className="h-8 w-8 text-gray-300" />
              <p className="mt-2 text-xs text-gray-400">{tResults('imageLoadFailed')}</p>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="animate-pulse flex flex-col items-center">
              <Music className="h-8 w-8 text-gray-300" />
              <div className="mt-2 h-2 w-16 bg-gray-200 rounded"></div>
            </div>
          </div>
        )}
        {isUpload && (
          <div className="absolute top-2 right-2">
            <StatusIndicator status={(item as TaskItem).status} className="bg-white/80 backdrop-blur-sm rounded-full px-2 py-1 text-xs" />
          </div>
        )}
      </div>
      <CardContent className="p-4 flex-1 flex flex-col justify-between">
        <div>
          <h3 className="font-semibold text-base mb-1 truncate">{item.name}</h3>
          {isUpload ? (
            <p className="text-xs text-muted-foreground"><Clock className="inline h-3 w-3 mr-1" />{item.date}</p>
          ) : (
            <p className="text-xs text-muted-foreground">{t('sharedByAt', { by: (item as ShareItem).sharedBy, date: item.date })}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
};


export default function HistoryPage() {
  const t = useTranslations('history');
  const tCommon = useTranslations('common');
  const tb = useBackendMessage();
  const { toast } = useToast();
  const router = useRouter();

  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const [searchQuery, setSearchQuery] = useState('');
  const [uploadsPage, setUploadsPage] = useState(1);
  const [sharesPage, setSharesPage] = useState(1);
  const [view, setView] = useState<'list' | 'grid'>('grid');
  const [selectedItems, setSelectedItems] = useState<string[]>([]);
  const [selectionMode, setSelectionMode] = useState(false);
  const [activeTab, setActiveTab] = useState('uploads');
  const ITEMS_PER_PAGE = view === 'list' ? 10 : 6;

  // 数据状态
  const [tasks, setTasks] = useState<TaskItem[]>([]);
  const [shares, setShares] = useState<ShareItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [totalTasks, setTotalTasks] = useState(0);
  const [totalShares, setTotalShares] = useState(0);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  // 加载任务列表（silent=true 时静默刷新，不显示 loading）
  const loadTasks = useCallback(async (silent = false) => {
    if (!silent) {
      setIsLoading(true);
    }
    try {
      const stateFilter = mapStatusToTaskState(statusFilter);
      const response = await tasksApi.listTasks(
        uploadsPage,
        ITEMS_PER_PAGE,
        stateFilter,
        sortBy,
        sortOrder,
        searchQuery || undefined
      );

      if (response.data) {
        const mappedTasks: TaskItem[] = response.data.map((task: Task) => ({
          id: task.task_id,
          name: task.title || t('taskLabel', { id: task.task_id.slice(0, 8) }),
          date: task.created_at || new Date().toISOString(),
          status: mapTaskStateToStatus(task.state),
          thumbnail: '', // 初始化为空
          thumbnailType: task.thumbnail_type,
        }));

        if (silent) {
          // 静默刷新：只更新状态有变化的任务，保留缩略图
          setTasks(prev => {
            return mappedTasks.map(newTask => {
              const existingTask = prev.find(t => t.id === newTask.id);
              if (existingTask) {
                // 保留已加载的缩略图，只更新状态
                return {
                  ...existingTask,
                  status: newTask.status,
                  thumbnailType: newTask.thumbnailType,
                };
              }
              return newTask; // 新任务
            });
          });
        } else {
          // 正常加载：重置所有任务
          setTasks(mappedTasks);
          setTotalTasks(response.pagination?.total || mappedTasks.length);

          // 异步加载真实缩略图
          mappedTasks.forEach(async (task) => {
            if (task.thumbnailType) {
              const blobUrl = await fetchAuthenticatedImage(task.id, task.thumbnailType);
              if (blobUrl) {
                setTasks(prev => prev.map((t) =>
                  t.id === task.id ? { ...t, thumbnail: blobUrl } : t
                ));
              } else {
                setTasks(prev => prev.map((t) =>
                  t.id === task.id ? { ...t, thumbnailError: true } : t
                ));
              }
            }
          });
        }
      }
    } catch (err) {
      console.error('加载任务列表失败:', err);
      if (!silent) {
        toast({
          title: t('loadFailed'),
          description: err instanceof ApiError ? err.message : t('loadTasksFailed'),
          variant: 'destructive',
        });
      }
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [uploadsPage, ITEMS_PER_PAGE, statusFilter, sortBy, sortOrder, searchQuery, toast]);

  // 加载收藏列表
  const loadShares = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await sharesApi.listSavedShares(
        sharesPage,
        ITEMS_PER_PAGE,
        sortBy,
        sortOrder,
        searchQuery || undefined
      );

      if (response.data) {
        const mappedShares: ShareItem[] = response.data.map((item) => ({
          id: item.id,
          name: item.task_title,
          sharedBy: item.shared_by || tb('anonymous'),
          date: item.created_at,
          thumbnail: '',
          taskId: item.task_id,
          thumbnailType: item.thumbnail_type,
          shareToken: item.share_token,
        }));
        setShares(mappedShares);
        setTotalShares(response.pagination.total);

        // 异步加载缩略图
        mappedShares.forEach(async (share) => {
          if (share.taskId && share.thumbnailType) {
            const blobUrl = await fetchAuthenticatedImage(share.taskId, share.thumbnailType);
            if (blobUrl) {
              setShares(prev => prev.map((s) =>
                s.id === share.id ? { ...s, thumbnail: blobUrl } : s
              ));
            }
          }
        });
      }
    } catch (err) {
      toast({
        title: t('loadFailed'),
        description: err instanceof ApiError ? err.message : t('loadSharesFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsLoading(false);
    }
  }, [sharesPage, ITEMS_PER_PAGE, sortBy, sortOrder, searchQuery, toast]);

  // 初始加载
  useEffect(() => {
    if (activeTab === 'uploads') {
      loadTasks();
    } else if (activeTab === 'shares') {
      loadShares();
    }
  }, [activeTab, loadTasks, loadShares]);

  // 轮询：有进行中/排队中的任务时每 5 秒刷新
  useEffect(() => {
    if (activeTab !== 'uploads') return;

    // 检查是否有需要轮询的任务（排队中或进行中）
    const hasActiveTask = tasks.some(
      t => t.status === 'queued' || t.status === 'in-progress'
    );

    if (!hasActiveTask) return;

    const interval = setInterval(() => {
      loadTasks(true); // 静默刷新，不触发 loading 状态
    }, 5000);

    return () => clearInterval(interval);
  }, [activeTab, tasks, loadTasks]);

  // 批量删除
  const handleBatchDelete = async () => {
    if (selectedItems.length === 0) return;

    setIsDeleting(true);
    try {
      if (activeTab === 'uploads') {
        // 删除任务
        const response = await tasksApi.batchDeleteTasks(selectedItems);
        toast({
          title: t('deleteSuccess'),
          description: t('deletedTasks', { count: String(response.data?.deleted_count || selectedItems.length) }),
        });
        loadTasks();
      } else {
        // 删除收藏
        const ids = selectedItems.map(id => parseInt(id, 10));
        await sharesApi.batchDeleteSavedShares(ids);
        toast({
          title: t('deleteSuccess'),
          description: t('deletedShares', { count: String(selectedItems.length) }),
        });
        loadShares();
      }
      setSelectedItems([]);
      setSelectionMode(false);
    } catch (err) {
      toast({
        title: t('downloadFailed'),
        description: err instanceof ApiError ? err.message : t('batchDeleteFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  // 批量下载
  const handleBatchDownload = async () => {
    if (selectedItems.length === 0) return;

    setIsDownloading(true);
    try {
      // 根据当前标签页获取正确的 taskIds
      let taskIds: string[];
      if (activeTab === 'uploads') {
        taskIds = selectedItems;
      } else {
        // 收藏列表：从 shares 中根据 saved_share.id 获取 taskId
        taskIds = selectedItems
          .map(id => {
            const share = shares.find(s => String(s.id) === id);
            return share?.taskId;
          })
          .filter((id): id is string => !!id);
      }

      if (taskIds.length === 0) {
        toast({
          title: t('downloadFailed'),
          description: t('noDownloadable'),
          variant: 'destructive',
        });
        return;
      }

      const result = await tasksApi.archiveTasks(taskIds, ['png', 'xml']);
      filesApi.triggerDownload(result.blob, `scores_${Date.now()}.zip`);

      // 显示统计信息
      if (result.skippedCount > 0) {
        toast({
          title: t('downloadComplete'),
          description: t('downloadCompleteDesc', { downloaded: String(result.downloadedCount), skipped: String(result.skippedCount) }),
        });
      } else {
        toast({
          title: t('downloadSuccess'),
          description: t('downloadSuccessDesc', { downloaded: String(result.downloadedCount) }),
        });
      }
    } catch (err) {
      toast({
        title: t('downloadFailed'),
        description: err instanceof ApiError ? err.message : t('batchDownloadFailed'),
        variant: 'destructive',
      });
    } finally {
      setIsDownloading(false);
    }
  };

  const filteredTasks = useMemo(() => tasks, [tasks]);
  const uploadsPageCount = Math.ceil(totalTasks / ITEMS_PER_PAGE);
  const sharesPageCount = Math.ceil(totalShares / ITEMS_PER_PAGE);

  const currentTabItems = useMemo(() => {
    return activeTab === 'uploads' ? filteredTasks : shares;
  }, [activeTab, filteredTasks, shares]);

  const handleSelectItem = (id: string) => {
    setSelectedItems(prev =>
      prev.includes(id) ? prev.filter(i => i !== id) : [...prev, id]
    );
  };

  const handleSelectAll = (isChecked: boolean) => {
    const currentPageIds = activeTab === 'uploads'
      ? tasks.map(item => item.id)
      : shares.map(item => String(item.id));

    if (isChecked) {
      // 合并当前页到已选中（保留其他页的选中）
      setSelectedItems(prev => {
        const newSet = new Set(prev);
        currentPageIds.forEach(id => newSet.add(id));
        return Array.from(newSet);
      });
    } else {
      // 只移除当前页的选中（保留其他页的选中）
      setSelectedItems(prev => prev.filter(id => !currentPageIds.includes(id)));
    }
  };

  const toggleSelectionMode = () => {
    const newMode = !selectionMode;
    setSelectionMode(newMode);
    if (!newMode) {
      setSelectedItems([]);
    }
  };

  const handleTabChange = (value: string) => {
    setActiveTab(value);
    setSelectionMode(false);
    setSelectedItems([]);
  }

  const numSelected = selectedItems.length;
  // 检查当前页的任务是否全部被选中
  const currentPageIds = activeTab === 'uploads'
    ? tasks.map(item => item.id)
    : shares.map(item => String(item.id));
  const isAllSelectedInCurrentTab = currentPageIds.length > 0 &&
    currentPageIds.every(id => selectedItems.includes(id));

  const handleRowClick = (item: TaskItem | ShareItem, isUpload: boolean) => {
    const itemId = isUpload ? (item as TaskItem).id : String((item as ShareItem).id);
    if (selectionMode) {
      handleSelectItem(itemId);
    } else {
      if (isUpload) {
        const link = getTaskLink(item as TaskItem);
        router.push(link);
      } else {
        const shareItem = item as ShareItem;
        if (shareItem.shareToken) {
          router.push(`/share/${shareItem.shareToken}`);
        }
      }
    }
  };

  const PaginationControls = ({ currentPage, pageCount, onPageChange }: { currentPage: number, pageCount: number, onPageChange: (page: number) => void }) => {
    if (pageCount <= 1) return null;
    return (
      <div className="flex items-center justify-end gap-2 mt-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage === 1}
        >
          {tCommon('prevPage')}
        </Button>
        <span className="text-sm text-muted-foreground">
          {tCommon('pageInfo', { current: String(currentPage), total: String(pageCount) })}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage === pageCount}
        >
          {tCommon('nextPage')}
        </Button>
      </div>
    );
  };

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col">
      <div className="bg-gray-900">
        <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
          <p className="text-lg text-gray-300">{t('subtitle')}</p>
        </div>
      </div>

      <main className="flex-grow">
        <div className="max-w-7xl mx-auto px-4 py-16">
          <Tabs defaultValue="uploads" className="w-full" onValueChange={handleTabChange}>
            <TabsList className="grid w-full grid-cols-2 bg-gray-200 rounded-full h-auto p-1 mb-4 max-w-md mx-auto">
              <TabsTrigger value="uploads" className="rounded-full data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:shadow-md py-2">{t('myUploads')}</TabsTrigger>
              <TabsTrigger value="shares" className="rounded-full data-[state=active]:bg-white data-[state=active]:text-black data-[state=active]:shadow-md py-2">{t('savedShares')}</TabsTrigger>
            </TabsList>
            <Card className="bg-white p-6 rounded-2xl shadow-lg">
              <CardContent className="p-0">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-6">
                  {selectionMode ? (
                    <div className="flex w-full items-center gap-4 flex-wrap">
                      <Checkbox
                        checked={isAllSelectedInCurrentTab}
                        onCheckedChange={(checked) => handleSelectAll(Boolean(checked))}
                        aria-label={tCommon('selectAll')}
                        className="h-5 w-5"
                      />
                      <span className="text-sm font-medium text-muted-foreground shrink-0">
                        {numSelected > 0 ? t('selectedCount', { count: numSelected }) : tCommon('selectAll')}
                      </span>
                      <div className="ml-auto flex items-center gap-2">
                        <Button variant="outline" size="sm" disabled={numSelected === 0 || isDownloading} onClick={handleBatchDownload}>
                          {isDownloading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                          {t('batchDownload')}
                        </Button>
                        <Button variant="destructive" size="sm" disabled={numSelected === 0 || isDeleting} onClick={handleBatchDelete}>
                          {isDeleting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
                          {t('batchDelete')}
                        </Button>
                        <Button variant="ghost" onClick={toggleSelectionMode}>{tCommon('done')}</Button>
                      </div>
                    </div>
                  ) : (
                    <div className="w-full flex flex-col gap-4">
                      <div className="relative w-full">
                        <Input
                          placeholder={t('searchPlaceholder')}
                          className="pl-10 bg-white h-12"
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                        />
                        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground" />
                      </div>
                      <div className="flex flex-wrap md:flex-nowrap items-center justify-between gap-4">
                        <div className="flex flex-col md:flex-row items-center gap-4 w-full md:w-auto">
                          <Select
                            value={`${sortBy === 'title' ? 'name' : 'date'}_${sortOrder}`}
                            onValueChange={(value) => {
                              const [field, order] = value.split('_');
                              setSortBy(field === 'name' ? 'title' : 'created_at');
                              setSortOrder(order);
                            }}
                          >
                            <SelectTrigger id="sort" className="w-full md:w-[180px] bg-white h-12">
                              <SelectValue placeholder={t('sortDateDesc')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="date_desc">{t('sortDateDesc')}</SelectItem>
                              <SelectItem value="date_asc">{t('sortDateAsc')}</SelectItem>
                              <SelectItem value="name_asc">{t('sortNameAsc')}</SelectItem>
                              <SelectItem value="name_desc">{t('sortNameDesc')}</SelectItem>
                            </SelectContent>
                          </Select>
                          <Select defaultValue="all" onValueChange={setStatusFilter}>
                            <SelectTrigger id="status" className="w-full md:w-[180px] bg-white h-12">
                              <SelectValue placeholder={t('filterAll')} />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="all">{t('filterAll')}</SelectItem>
                              <SelectItem value="completed">{t('statusCompleted')}</SelectItem>
                              <SelectItem value="pending-review">{t('statusPendingReview')}</SelectItem>
                              <SelectItem value="in-progress">{t('statusInProgress')}</SelectItem>
                              <SelectItem value="queued">{t('statusQueued')}</SelectItem>
                              <SelectItem value="failed">{t('statusFailed')}</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <Button variant="outline" onClick={toggleSelectionMode} className="bg-white h-12">
                            <Edit className="mr-2 h-4 w-4" />
                            {tCommon('edit')}
                          </Button>
                          <div className="flex items-center justify-center gap-1 bg-white border p-1 rounded-lg shadow-sm">
                            <Button variant={view === 'list' ? 'secondary' : 'ghost'} size="icon" className="h-10 w-10" onClick={() => setView('list')}>
                              <List className="h-5 w-5" />
                            </Button>
                            <Button variant={view === 'grid' ? 'secondary' : 'ghost'} size="icon" className="h-10 w-10" onClick={() => setView('grid')}>
                              <LayoutGrid className="h-5 w-5" />
                            </Button>
                          </div>
                        </div>
                      </div>
                    </div>
                  )}
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
                  ) : view === 'list' ? (
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
                              <StatusIndicator status={item.status} />
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
                        <ScoreCard
                          key={item.id}
                          item={item}
                          isSelected={selectedItems.includes(item.id)}
                          onSelect={handleSelectItem}
                          selectionMode={selectionMode}
                          isUpload={true}
                        />
                      ))}
                    </div>
                  )}
                  <PaginationControls currentPage={uploadsPage} pageCount={uploadsPageCount} onPageChange={setUploadsPage} />
                </TabsContent>

                <TabsContent value="shares">
                  {shares.length === 0 ? (
                    <div className="text-center py-20">
                      <Eye className="h-16 w-16 mx-auto text-muted-foreground mb-4" />
                      <p className="text-lg text-muted-foreground">{t('noShares')}</p>
                    </div>
                  ) : view === 'list' ? (
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
                        <ScoreCard
                          key={item.id}
                          item={item}
                          isSelected={selectedItems.includes(String(item.id))}
                          onSelect={handleSelectItem}
                          selectionMode={selectionMode}
                          isUpload={false}
                        />
                      ))}
                    </div>
                  )}
                  <PaginationControls currentPage={sharesPage} pageCount={sharesPageCount} onPageChange={setSharesPage} />
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
