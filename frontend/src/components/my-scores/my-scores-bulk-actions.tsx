'use client';

import { Globe2, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';

interface MyScoresBulkActionsProps {
  selectedCount: number;
  selectedJobCount: number;
  allSelected: boolean;
  publishPending: boolean;
  unpublishPending: boolean;
  deletePending: boolean;
  showPublishAction: boolean;
  showUnpublishAction: boolean;
  onToggleSelectAll: (checked: boolean) => void;
  onPublishSelected: () => void;
  onUnpublishSelected: () => void;
  onDeleteSelected: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function MyScoresBulkActions({
  selectedCount,
  selectedJobCount,
  allSelected,
  publishPending,
  unpublishPending,
  deletePending,
  showPublishAction,
  showUnpublishAction,
  onToggleSelectAll,
  onPublishSelected,
  onUnpublishSelected,
  onDeleteSelected,
  t,
}: MyScoresBulkActionsProps) {
  const totalSelected = selectedCount + selectedJobCount;

  return (
    <div className="mb-5 flex flex-col gap-3 rounded-2xl border bg-white p-4 shadow-sm lg:flex-row lg:items-center lg:justify-between">
      <div className="flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
          <Checkbox
            checked={allSelected}
            onCheckedChange={(checked) => onToggleSelectAll(checked === true)}
            aria-label={t('selectAll')}
          />
          {t('selectAll')}
        </label>
        <span className="text-sm text-muted-foreground">
          {t('selectedCount', { count: totalSelected })}
        </span>
      </div>
      <div className="flex flex-wrap gap-2">
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
        <Button
          type="button"
          size="sm"
          variant="destructive"
          disabled={!totalSelected || deletePending}
          onClick={onDeleteSelected}
        >
          <Trash2 className="mr-2 h-4 w-4" />
          {t('delete')}
        </Button>
      </div>
    </div>
  );
}
