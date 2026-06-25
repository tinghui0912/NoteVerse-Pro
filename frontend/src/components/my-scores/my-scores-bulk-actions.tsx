'use client';

import { Archive, BookOpen, Globe2, RotateCcw, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MyScoresBulkActionsProps {
  selectedCount: number;
  selectedJobCount: number;
  addToLibraryPending: boolean;
  archivePending: boolean;
  restorePending: boolean;
  publishPending: boolean;
  unpublishPending: boolean;
  retryJobsPending: boolean;
  dismissJobsPending: boolean;
  deletePending: boolean;
  showArchiveAction: boolean;
  showRestoreAction: boolean;
  showPublishAction: boolean;
  showUnpublishAction: boolean;
  showJobActions: boolean;
  onSelectVisible: () => void;
  onClearSelection: () => void;
  onAddToLibrary: () => void;
  onArchiveSelected: () => void;
  onRestoreSelected: () => void;
  onPublishSelected: () => void;
  onUnpublishSelected: () => void;
  onDeleteSelected: () => void;
  onRetrySelectedJobs: () => void;
  onDismissSelectedJobs: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function MyScoresBulkActions({
  selectedCount,
  selectedJobCount,
  addToLibraryPending,
  archivePending,
  restorePending,
  publishPending,
  unpublishPending,
  retryJobsPending,
  dismissJobsPending,
  deletePending,
  showArchiveAction,
  showRestoreAction,
  showPublishAction,
  showUnpublishAction,
  showJobActions,
  onSelectVisible,
  onClearSelection,
  onAddToLibrary,
  onArchiveSelected,
  onRestoreSelected,
  onPublishSelected,
  onUnpublishSelected,
  onDeleteSelected,
  onRetrySelectedJobs,
  onDismissSelectedJobs,
  t,
}: MyScoresBulkActionsProps) {
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onSelectVisible}>
          {t('selectVisible')}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onClearSelection}
          disabled={selectedCount + selectedJobCount === 0}
        >
          {t('clearSelection')}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t('selectedCount', { count: selectedCount + selectedJobCount })}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={!selectedCount || addToLibraryPending}
          onClick={onAddToLibrary}
        >
          <BookOpen className="mr-2 h-4 w-4" />
          {t('addToLibrary')}
        </Button>
        {showArchiveAction ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!selectedCount || archivePending}
            onClick={onArchiveSelected}
          >
            <Archive className="mr-2 h-4 w-4" />
            {t('archiveSelected')}
          </Button>
        ) : null}
        {showPublishAction ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!selectedCount || publishPending}
            onClick={onPublishSelected}
          >
            <Globe2 className="mr-2 h-4 w-4" />
            {t('publishSelected')}
          </Button>
        ) : null}
        {showUnpublishAction ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!selectedCount || unpublishPending}
            onClick={onUnpublishSelected}
          >
            <Globe2 className="mr-2 h-4 w-4" />
            {t('unpublishSelected')}
          </Button>
        ) : null}
        {showRestoreAction ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={!selectedCount || restorePending}
            onClick={onRestoreSelected}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {t('restoreSelected')}
          </Button>
        ) : null}
        {showJobActions ? (
          <>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!selectedJobCount || retryJobsPending}
              onClick={onRetrySelectedJobs}
            >
              <RotateCcw className="mr-2 h-4 w-4" />
              {t('retrySelectedJobs')}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="destructive"
              disabled={!selectedJobCount || dismissJobsPending}
              onClick={onDismissSelectedJobs}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('dismissSelectedJobs')}
            </Button>
          </>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={!selectedCount || deletePending}
          onClick={onDeleteSelected}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t('deleteSelected')}
        </Button>
      </div>
    </div>
  );
}
