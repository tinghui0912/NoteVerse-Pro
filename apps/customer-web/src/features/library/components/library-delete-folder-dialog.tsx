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
import type { LibraryFolderRead } from '@/generated/api';

interface LibraryDeleteFolderDialogProps {
  folder: LibraryFolderRead | null;
  deletePending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function LibraryDeleteFolderDialog({
  folder,
  deletePending,
  onOpenChange,
  onConfirm,
  t,
}: LibraryDeleteFolderDialogProps) {
  return (
    <AlertDialog open={folder !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('deleteFolderTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {folder
              ? t('deleteFolderDescription', { name: folder.name })
              : null}
          </AlertDialogDescription>
        </AlertDialogHeader>
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
