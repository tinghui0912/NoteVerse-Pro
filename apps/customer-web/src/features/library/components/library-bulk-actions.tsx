'use client';

import { FolderInput, Star, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

interface LibraryBulkActionsProps {
  selectedCount: number;
  allSelected: boolean;
  pending: boolean;
  onToggleSelectAll: (checked: boolean) => void;
  onFavorite: () => void;
  onOpenMoveDialog: () => void;
  onUnfavorite: () => void;
  onDeleteScores?: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function LibraryBulkActions({
  selectedCount,
  allSelected,
  pending,
  onToggleSelectAll,
  onFavorite,
  onOpenMoveDialog,
  onUnfavorite,
  onDeleteScores,
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
        <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center sm:justify-end">
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={onFavorite}
            disabled={!selectedCount || pending}
          >
            <Star className="mr-2 h-4 w-4" />
            {t('favorite')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={onOpenMoveDialog}
            disabled={!selectedCount || pending}
          >
            <FolderInput className="mr-2 h-4 w-4" />
            {t('moveTo')}
          </Button>
          <Button
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={onUnfavorite}
            disabled={!selectedCount || pending}
          >
            <Star className="mr-2 h-4 w-4" />
            {t('unfavorite')}
          </Button>
          {onDeleteScores ? (
            <Button
              type="button"
              variant="destructive"
              onClick={onDeleteScores}
              disabled={!selectedCount || pending}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              {t('deleteSelectedScores')}
            </Button>
          ) : null}
        </div>
      </CardContent>
    </Card>
  );
}
