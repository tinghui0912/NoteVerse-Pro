'use client';

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { FolderDeleteMode, LibraryFolder } from '@/types/api';

interface LibraryDeleteFolderDialogProps {
  folder: LibraryFolder | null;
  deleteMode: FolderDeleteMode;
  deletePending: boolean;
  onOpenChange: (open: boolean) => void;
  onDeleteModeChange: (mode: FolderDeleteMode) => void;
  onConfirm: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function LibraryDeleteFolderDialog({
  folder,
  deleteMode,
  deletePending,
  onOpenChange,
  onDeleteModeChange,
  onConfirm,
  t,
}: LibraryDeleteFolderDialogProps) {
  return (
    <AlertDialog open={folder !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('deleteFolderTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {folder ? t('deleteFolderDescription', { name: folder.name }) : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <label className="text-sm font-medium" htmlFor="library-delete-mode">
            {t('deleteModeLabel')}
          </label>
          <Select value={deleteMode} onValueChange={(value) => onDeleteModeChange(value as FolderDeleteMode)}>
            <SelectTrigger id="library-delete-mode">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="MOVE_CONTENTS_TO_PARENT">
                {t('deleteModeMoveToParent')}
              </SelectItem>
              <SelectItem value="MOVE_CONTENTS_TO_ROOT">
                {t('deleteModeMoveToRoot')}
              </SelectItem>
              <SelectItem value="TRASH_CONTENTS">
                {t('deleteModeTrashContents')}
              </SelectItem>
            </SelectContent>
          </Select>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={onConfirm}
            disabled={deletePending}
          >
            {t('deleteFolder')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
