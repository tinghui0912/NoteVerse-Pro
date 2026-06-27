'use client';

import { FolderInput, Tags, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

interface LibraryBulkActionsProps {
  selectedCount: number;
  allSelected: boolean;
  pending: boolean;
  onToggleSelectAll: (checked: boolean) => void;
  onOpenPracticeStateDialog: () => void;
  onOpenMoveDialog: () => void;
  onOpenDeleteDialog: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function LibraryBulkActions({
  selectedCount,
  allSelected,
  pending,
  onToggleSelectAll,
  onOpenPracticeStateDialog,
  onOpenMoveDialog,
  onOpenDeleteDialog,
  t,
}: LibraryBulkActionsProps) {
  return (
    <Card className="mb-5 rounded-2xl">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-3 text-sm font-medium">
            <Checkbox
              checked={allSelected}
              onCheckedChange={(checked) => onToggleSelectAll(checked === true)}
              aria-label={t('selectAll')}
            />
            {t('selectAll')}
          </label>
          <span className="text-sm font-medium text-muted-foreground">
            {t('selectedCount', { count: selectedCount })}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onOpenPracticeStateDialog}
            disabled={!selectedCount || pending}
          >
            <Tags className="mr-2 h-4 w-4" />
            {t('markAs')}
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={onOpenMoveDialog}
            disabled={!selectedCount || pending}
          >
            <FolderInput className="mr-2 h-4 w-4" />
            {t('moveTo')}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onOpenDeleteDialog}
            disabled={!selectedCount || pending}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('deleteEntry')}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
