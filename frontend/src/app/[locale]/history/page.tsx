'use client';

import { useTranslations } from 'next-intl';
import { useBackendMessage } from '@/hooks/use-backend-message';
import Image from 'next/image';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Music, Search, CheckCircle2, XCircle, Clock, LoaderCircle, ChevronRight, Eye, List, LayoutGrid, Trash2, Download, Edit, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useState, useMemo, useEffect, useRef } from 'react';
import { fetchAuthenticatedImage } from '@/lib/utils/image';
import { Checkbox } from '@/components/ui/checkbox';
import { useRouter } from 'next/navigation';
import { Footer } from '@/components/layout/footer';
import { filesApi } from '@/lib/api';
import type { Task, TaskState } from '@/types/api';
import { ApiError } from '@/lib/api-client';
import { useToast } from '@/hooks/use-toast';
import { useTaskList, useDeleteTasks, useArchiveTasks } from '@/hooks/queries/use-task-queries';
import { useSavedShares, useDeleteSavedShares } from '@/hooks/queries/use-share-queries';

type UploadStatus = 'completed' | 'pending-review' | 'in-progress' | 'queued' | 'failed';

// 灏?TaskState 杞崲涓?UploadStatus
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

// 灏?UploadStatus 杞崲鍥?TaskState
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
  thumbnailError?: boolean; // 鍥剧墖鍔犺浇澶辫触鏍囪
}

interface ShareItem {
  id: number;
  name: string;
  sharedBy: string;
  date: string;
  thumbnail: string;
  taskId?: string;  // 鐢ㄤ簬鍔犺浇缂╃暐鍥?
  thumbnailType?: string;  // 缂╃暐鍥剧被鍨?
  shareToken?: string;  // 鐢ㄤ簬璺宠浆鍒板垎浜〉
}

const statusConfig: Record<UploadStatus, { labelKey: string; icon: React.ElementType; color: string; animation?: string }> = {
  completed: { labelKey: 'statusCompleted', icon: CheckCircle2, color: 'text-green-500' },
  'pending-review': { labelKey: 'statusPendingReview', icon: Clock, color: 'text-orange-500' },
  'in-progress': { labelKey: 'statusInProgress', icon: LoaderCircle, color: 'text-blue-500', animation: 'animate-spin' },
  queued: { labelKey: 'statusQueued', icon: Clock, color: 'text-yellow-500' },
  failed: { labelKey: 'statusFailed', icon: XCircle, color: 'text-red-500' },
};

// 鏍规嵁浠诲姟鐘舵€佸喅瀹氳烦杞洰鏍?
const getTaskLink = (item: TaskItem): string => {
  // 鎺掗槦涓?杩涜涓?澶辫触 鈫?/upload?task_id=xxx
  if (item.status === 'queued' || item.status === 'in-progress' || item.status === 'failed') {
    return `/upload?task_id=${item.id}`;
  }

  // 寰呭鏍?鈫?/review
  if (item.status === 'pending-review') {
    return `/review/${item.id}`;
  }

  // 宸插畬鎴?(SUCCESS) 鈫?/results
  return `/results/${item.id}`;
};

const StatusIndicator = ({ status, className }: { status: UploadStatus, className?: string }) => {
  const t = useTranslations('history');
  const config = statusConfig[status];
  return (
    <div className={cn('flex items-center text-sm font-medium', config.color, className)}>
      <config.icon className={cn('mr-2 h-4 w-4', config.animation)} />
      <span>{t(config.labelKey as never)}</span>
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
  const tResults = useTranslations('results');

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
      <div className="relative aspect-4/3 bg-gray-100">
        {item.thumbnail ? (
          <Image
            src={item.thumbnail}
            alt={item.name}
            fill
            unoptimized={item.thumbnail.startsWith('http')}
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
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

const PaginationControls = ({
  currentPage,
  pageCount,
  onPageChange,
}: {
  currentPage: number;
  pageCount: number;
  onPageChange: (page: number) => void;
}) => {
  const tCommon = useTranslations('common');

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

  // 鏁版嵁鐘舵€?
  const [taskThumbnails, setTaskThumbnails] = useState<Record<string, { thumbnail: string; thumbnailError?: boolean }>>({});
  const [shareThumbnails, setShareThumbnails] = useState<Record<number, string>>({});

  // Mutations
  const deleteTasksMutation = useDeleteTasks();
  const deleteSavedSharesMutation = useDeleteSavedShares();
  const archiveTasksMutation = useArchiveTasks();

  const stateFilter = mapStatusToTaskState(statusFilter);

  // 1. TanStack Query锛氫换鍔″垪琛ㄦ煡璇?
  const { data: tasksResponse, isLoading: isTasksLoading } = useTaskList(
    { page: uploadsPage, pageSize: ITEMS_PER_PAGE, state: stateFilter, sortBy, sortOrder, search: searchQuery || undefined },
    { refetchInterval: (activeTab === 'uploads' && statusFilter === 'all') ? 5000 : false }
  );

  const fetchingTaskThumbsRef = useRef<Set<string>>(new Set());

  const tasks = useMemo<TaskItem[]>(() => {
    return (tasksResponse?.data ?? []).map((task: Task) => ({
      id: task.task_id,
      name: task.title || t('taskLabel', { id: task.task_id.slice(0, 8) }),
      date: task.created_at || new Date().toISOString(),
      status: mapTaskStateToStatus(task.state),
      thumbnail: taskThumbnails[task.task_id]?.thumbnail ?? '',
      thumbnailType: task.thumbnail_type,
      thumbnailError: taskThumbnails[task.task_id]?.thumbnailError,
    }));
  }, [tasksResponse?.data, t, taskThumbnails]);

  // 鍔犺浇缂╃暐鍥?
  useEffect(() => {
    // 鐙珛瑙﹀彂缂╃暐鍥捐姹?
    tasks.forEach(task => {
      if (task.thumbnailType && !fetchingTaskThumbsRef.current.has(task.id)) {
        fetchingTaskThumbsRef.current.add(task.id);
        fetchAuthenticatedImage(task.id, task.thumbnailType).then(imageUrl => {
          setTaskThumbnails(current => ({
            ...current,
            [task.id]: { thumbnail: imageUrl || '', thumbnailError: !imageUrl },
          }));
        }).catch(() => {
          setTaskThumbnails(current => ({
            ...current,
            [task.id]: { thumbnail: '', thumbnailError: true },
          }));
        });
      }
    });
  }, [tasks]);

  // 2. TanStack Query锛氭敹钘忓垪琛ㄦ煡璇?
  const { data: sharesResponse, isLoading: isSharesLoading } = useSavedShares({
    page: sharesPage, pageSize: ITEMS_PER_PAGE, sortBy, sortOrder, search: searchQuery || undefined
  });

  const fetchingShareThumbsRef = useRef<Set<number>>(new Set());

  const shares = useMemo<ShareItem[]>(() => {
    return (sharesResponse?.data ?? []).map((item) => ({
      id: item.id,
      name: item.task_title,
      sharedBy: item.shared_by || tb('anonymous'),
      date: item.created_at,
      thumbnail: shareThumbnails[item.id] ?? '',
      taskId: item.task_id,
      thumbnailType: item.thumbnail_type,
      shareToken: item.share_token,
    }));
  }, [sharesResponse?.data, shareThumbnails, tb]);

  // 鍔犺浇鏀惰棌缂╃暐鍥?
  useEffect(() => {
    shares.forEach(share => {
      if (share.taskId && share.thumbnailType && !fetchingShareThumbsRef.current.has(share.id)) {
        fetchingShareThumbsRef.current.add(share.id);
        fetchAuthenticatedImage(share.taskId, share.thumbnailType).then(imageUrl => {
          if (imageUrl) {
            setShareThumbnails(current => ({
              ...current,
              [share.id]: imageUrl,
            }));
          }
        });
      }
    });
  }, [shares]);

  // 鍚堝苟 loading 鍜?pending 鐘舵€?
  const isLoading = activeTab === 'uploads' ? isTasksLoading : isSharesLoading;
  const isDeleting = deleteTasksMutation.isPending || deleteSavedSharesMutation.isPending;
  const isDownloading = archiveTasksMutation.isPending;

  // 鎵归噺鍒犻櫎
  const handleBatchDelete = () => {
    if (selectedItems.length === 0) return;

    if (activeTab === 'uploads') {
      deleteTasksMutation.mutate(selectedItems, {
        onSuccess: (response) => {
          toast({
            title: t('deleteSuccess'),
            description: t('deletedTasks', { count: String(response.data?.deleted_count || selectedItems.length) }),
          });
          setSelectedItems([]);
          setSelectionMode(false);
        },
        onError: (err) => {
          toast({ title: t('downloadFailed'), description: err instanceof ApiError ? err.message : t('batchDeleteFailed'), variant: 'destructive' });
        }
      });
    } else {
      const ids = selectedItems.map(id => parseInt(id, 10));
      deleteSavedSharesMutation.mutate(ids, {
        onSuccess: () => {
          toast({
            title: t('deleteSuccess'),
            description: t('deletedShares', { count: String(selectedItems.length) }),
          });
          setSelectedItems([]);
          setSelectionMode(false);
        },
        onError: (err) => {
          toast({ title: t('downloadFailed'), description: err instanceof ApiError ? err.message : t('batchDeleteFailed'), variant: 'destructive' });
        }
      });
    }
  };

  // 鎵归噺涓嬭浇
  const handleBatchDownload = () => {
    if (selectedItems.length === 0) return;

    // 鏍规嵁褰撳墠鏍囩椤佃幏鍙栨纭殑 taskIds
    let taskIds: string[];
    if (activeTab === 'uploads') {
      taskIds = selectedItems;
    } else {
      // 鏀惰棌鍒楄〃锛氫粠 shares 涓牴鎹?saved_share.id 鑾峰彇 taskId
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

    archiveTasksMutation.mutate(
      { taskIds, includeTypes: ['image', 'xml'] },
      {
        onSuccess: (result) => {
          filesApi.triggerDownload(result.blob, `scores_${Date.now()}.zip`);

          // 鏄剧ず缁熻淇℃伅
          if (result.skippedCount > 0) {
            toast({
              title: t('downloadPartial'),
              description: t('downloadPartialDesc', { success: String(result.downloadedCount), skipped: String(result.skippedCount) }),
            });
          } else {
            toast({
              title: t('downloadSuccess'),
              description: t('downloadSuccessDesc', { count: String(result.downloadedCount) }),
            });
          }
          setSelectedItems([]);
          setSelectionMode(false);
        },
        onError: (err) => {
          toast({
            title: t('downloadFailed'),
            description: err instanceof ApiError && err.code ? tb(err.code as never) : err.message || t('downloadFailedDesc'),
            variant: 'destructive',
          });
        }
      }
    );
  };

  const totalTasks = tasksResponse?.pagination?.total ?? tasks.length;
  const totalShares = sharesResponse?.pagination?.total ?? shares.length;
  const uploadsPageCount = Math.ceil(totalTasks / ITEMS_PER_PAGE);
  const sharesPageCount = Math.ceil(totalShares / ITEMS_PER_PAGE);

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
      // 鍚堝苟褰撳墠椤靛埌宸查€変腑锛堜繚鐣欏叾浠栭〉鐨勯€変腑锛?
      setSelectedItems(prev => {
        const newSet = new Set(prev);
        currentPageIds.forEach(id => newSet.add(id));
        return Array.from(newSet);
      });
    } else {
      // 鍙Щ闄ゅ綋鍓嶉〉鐨勯€変腑锛堜繚鐣欏叾浠栭〉鐨勯€変腑锛?
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
  // 妫€鏌ュ綋鍓嶉〉鐨勪换鍔℃槸鍚﹀叏閮ㄨ閫変腑
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
                            <SelectTrigger id="sort" className="w-full md:w-45 bg-white h-12">
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
                            <SelectTrigger id="status" className="w-full md:w-45 bg-white h-12">
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
