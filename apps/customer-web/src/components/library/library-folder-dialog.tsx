'use client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';

interface LibraryFolderDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  folderName: string;
  createPending: boolean;
  updatePending: boolean;
  onOpenChange: (open: boolean) => void;
  onFolderNameChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  t: (key: string) => string;
}

export function LibraryFolderDialog({
  open,
  mode,
  folderName,
  createPending,
  updatePending,
  onOpenChange,
  onFolderNameChange,
  onSubmit,
  onCancel,
  t,
}: LibraryFolderDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {mode === 'edit' ? t('editFolderTitle') : t('createFolderTitle')}
          </DialogTitle>
          <DialogDescription>
            {mode === 'edit'
              ? t('editFolderDescription')
              : t('createFolderDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label
              className="text-sm font-medium"
              htmlFor="library-folder-name"
            >
              {t('folderNameLabel')}
            </label>
            <Input
              id="library-folder-name"
              value={folderName}
              onChange={(event) => onFolderNameChange(event.target.value)}
              placeholder={t('folderNamePlaceholder')}
              autoFocus
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            {t('cancel')}
          </Button>
          <Button
            onClick={onSubmit}
            disabled={!folderName.trim() || createPending || updatePending}
          >
            {mode === 'edit' ? t('saveFolder') : t('createFolder')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
