'use client';

import { useTranslations } from 'next-intl';
import { filesApi } from '@/lib/api';
import { ApiError } from '@/lib/api-client';
import { useBackendMessage } from '@/hooks/use-backend-message';
import { useToast } from '@/hooks/use-toast';
import { useArchiveTasks, useDeleteTasks } from '@/hooks/queries/use-task-queries';
import { useDeleteSavedShares } from '@/hooks/queries/use-share-queries';
import type { HistoryTab, ShareHistoryItem } from '@/components/history/history-types';

interface HistoryBatchActionsOptions {
  activeTab: HistoryTab;
  selectedItems: string[];
  shares: ShareHistoryItem[];
  onComplete: () => void;
}

export function useHistoryBatchActions({ activeTab, selectedItems, shares, onComplete }: HistoryBatchActionsOptions) {
  const t = useTranslations('history');
  const backendMessage = useBackendMessage();
  const { toast } = useToast();
  const deleteTasks = useDeleteTasks();
  const deleteSavedShares = useDeleteSavedShares();
  const archiveTasks = useArchiveTasks();

  const deleteSelected = () => {
    if (selectedItems.length === 0) return;
    const onError = (error: Error) => {
      toast({
        title: t('downloadFailed'),
        description: error instanceof ApiError ? error.message : t('batchDeleteFailed'),
        variant: 'destructive',
      });
    };

    if (activeTab === 'uploads') {
      deleteTasks.mutate(selectedItems, {
        onSuccess: (response) => {
          toast({
            title: t('deleteSuccess'),
            description: t('deletedTasks', { count: String(response.data?.deleted_count || selectedItems.length) }),
          });
          onComplete();
        },
        onError,
      });
      return;
    }

    deleteSavedShares.mutate(selectedItems.map((id) => Number.parseInt(id, 10)), {
      onSuccess: () => {
        toast({ title: t('deleteSuccess'), description: t('deletedShares', { count: String(selectedItems.length) }) });
        onComplete();
      },
      onError,
    });
  };

  const downloadSelected = () => {
    if (selectedItems.length === 0) return;
    const taskIds = activeTab === 'uploads'
      ? selectedItems
      : selectedItems
          .map((id) => shares.find((share) => String(share.id) === id)?.taskId)
          .filter((id): id is string => Boolean(id));

    if (taskIds.length === 0) {
      toast({ title: t('downloadFailed'), description: t('noDownloadable'), variant: 'destructive' });
      return;
    }

    archiveTasks.mutate(
      { taskIds, includeTypes: ['image', 'xml'] },
      {
        onSuccess: (result) => {
          filesApi.triggerDownload(result.blob, `scores_${Date.now()}.zip`);
          toast(
            result.skippedCount > 0
              ? {
                  title: t('downloadPartial'),
                  description: t('downloadPartialDesc', { success: String(result.downloadedCount), skipped: String(result.skippedCount) }),
                }
              : {
                  title: t('downloadSuccess'),
                  description: t('downloadSuccessDesc', { count: String(result.downloadedCount) }),
                }
          );
          onComplete();
        },
        onError: (error) => {
          toast({
            title: t('downloadFailed'),
            description: error instanceof ApiError && error.code
              ? backendMessage(error.code as never)
              : error.message || t('downloadFailedDesc'),
            variant: 'destructive',
          });
        },
      }
    );
  };

  return {
    deleteSelected,
    downloadSelected,
    isDeleting: deleteTasks.isPending || deleteSavedShares.isPending,
    isDownloading: archiveTasks.isPending,
  };
}
