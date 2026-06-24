'use client';

import { Archive, MoveRight, Star, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LibraryFolder } from '@/types/api';

interface LibraryBulkActionsProps {
  selectedCount: number;
  moveTargetFolderId: string;
  rootFolderValue: string;
  folders: LibraryFolder[];
  movePending: boolean;
  favoritePending: boolean;
  archivePending: boolean;
  trashPending: boolean;
  onMoveTargetChange: (folderId: string) => void;
  onMoveSelected: () => void;
  onFavoriteSelected: () => void;
  onArchiveSelected: () => void;
  onTrashSelected: () => void;
  onClearSelection: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function LibraryBulkActions({
  selectedCount,
  moveTargetFolderId,
  rootFolderValue,
  folders,
  movePending,
  favoritePending,
  archivePending,
  trashPending,
  onMoveTargetChange,
  onMoveSelected,
  onFavoriteSelected,
  onArchiveSelected,
  onTrashSelected,
  onClearSelection,
  t,
}: LibraryBulkActionsProps) {
  return (
    <Card className="mb-5 rounded-2xl">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 text-sm font-medium">
          <MoveRight className="h-4 w-4" />
          {t('selectedCount', { count: selectedCount })}
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={moveTargetFolderId} onValueChange={onMoveTargetChange}>
            <SelectTrigger className="w-full sm:w-56">
              <SelectValue placeholder={t('moveTargetPlaceholder')} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={rootFolderValue}>{t('libraryRoot')}</SelectItem>
              {folders.map((folder) => (
                <SelectItem key={folder.folder_id} value={folder.folder_id}>
                  {folder.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button onClick={onMoveSelected} disabled={movePending}>
            {t('moveSelected')}
          </Button>
          <Button
            variant="outline"
            onClick={onFavoriteSelected}
            disabled={favoritePending}
          >
            <Star className="mr-2 h-4 w-4" />
            {t('favoriteSelected')}
          </Button>
          <Button
            variant="outline"
            onClick={onArchiveSelected}
            disabled={archivePending}
          >
            <Archive className="mr-2 h-4 w-4" />
            {t('archiveSelected')}
          </Button>
          <Button
            variant="destructive"
            onClick={onTrashSelected}
            disabled={trashPending}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('trashSelected')}
          </Button>
          <Button variant="ghost" size="icon" onClick={onClearSelection}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
