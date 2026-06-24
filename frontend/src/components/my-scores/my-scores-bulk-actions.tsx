'use client';

import { Archive, BookOpen, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MyScoresBulkActionsProps {
  selectedCount: number;
  addToLibraryPending: boolean;
  archivePending: boolean;
  deletePending: boolean;
  onSelectVisible: () => void;
  onClearSelection: () => void;
  onAddToLibrary: () => void;
  onArchiveSelected: () => void;
  onDeleteSelected: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function MyScoresBulkActions({
  selectedCount,
  addToLibraryPending,
  archivePending,
  deletePending,
  onSelectVisible,
  onClearSelection,
  onAddToLibrary,
  onArchiveSelected,
  onDeleteSelected,
  t,
}: MyScoresBulkActionsProps) {
  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onSelectVisible}>
          {t('selectVisible')}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onClearSelection} disabled={!selectedCount}>
          {t('clearSelection')}
        </Button>
        <span className="text-sm text-muted-foreground">
          {t('selectedCount', { count: selectedCount })}
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
