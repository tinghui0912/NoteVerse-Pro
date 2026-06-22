'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { filesApi, jobsApi, scoreSharingApi, scoresApi } from '@/lib/api';
import { queryKeys } from '@/lib/query-client';
import { useToast } from '@/hooks/use-toast';
import { useDeleteScores } from '@/hooks/queries/use-score-queries';
import type { HistoryTab, TaskHistoryItem } from '@/components/history/history-types';

export function useHistoryBatchActions({
  activeTab,
  selectedItems,
  uploads,
  onComplete,
}: {
  activeTab: HistoryTab;
  selectedItems: string[];
  uploads: TaskHistoryItem[];
  onComplete: () => void;
}) {
  const t = useTranslations('history');
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const deleteScores = useDeleteScores();
  const deleteOthers = useMutation({
    mutationFn: async () => {
      if (activeTab === 'shares') {
        const ids = selectedItems.map((id) => Number(id.split(':')[1]));
        return scoreSharingApi.deleteBookmarks(ids);
      }
      const jobIds = selectedItems.filter((id) => id.startsWith('job:')).map((id) => id.slice(4));
      await Promise.all(jobIds.map((id) => jobsApi.deleteJob(id)));
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.jobs.lists() });
      void queryClient.invalidateQueries({ queryKey: queryKeys.scores.bookmarks() });
    },
  });
  const download = useMutation({
    mutationFn: async () => {
      const selectedScores = uploads.filter(
        (item) => selectedItems.includes(item.selectionId) && item.entity === 'score' && item.headRevisionId
      );
      for (const item of selectedScores) {
        const blob = await scoresApi.downloadArtifactArchive(
          item.id,
          item.headRevisionId!,
          'RENDERED_PAGE'
        );
        filesApi.triggerDownload(blob, `score_${item.id}.zip`);
      }
      return selectedScores.length;
    },
  });

  const deleteSelected = () => {
    const scoreIds = selectedItems.filter((id) => id.startsWith('score:')).map((id) => id.slice(6));
    void Promise.all([
      scoreIds.length ? deleteScores.mutateAsync(scoreIds) : Promise.resolve(),
      deleteOthers.mutateAsync(),
    ]).then(() => {
      toast({ title: t('deleteSuccess'), description: t('deletedTasks', { count: String(selectedItems.length) }) });
      onComplete();
    });
  };

  const downloadSelected = () => download.mutate(undefined, {
    onSuccess: (count) => {
      toast({ title: t('downloadSuccess'), description: t('downloadSuccessDesc', { count: String(count) }) });
      onComplete();
    },
  });

  return {
    deleteSelected,
    downloadSelected,
    isDeleting: deleteScores.isPending || deleteOthers.isPending,
    isDownloading: download.isPending,
  };
}
