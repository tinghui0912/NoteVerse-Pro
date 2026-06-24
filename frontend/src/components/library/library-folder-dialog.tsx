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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { LibraryFolder } from '@/types/api';

interface LibraryFolderDialogProps {
  open: boolean;
  mode: 'create' | 'edit';
  folderName: string;
  folderParentId: string;
  rootFolderValue: string;
  parentFolders: LibraryFolder[];
  createPending: boolean;
  updatePending: boolean;
  onOpenChange: (open: boolean) => void;
  onFolderNameChange: (value: string) => void;
  onFolderParentChange: (value: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  t: (key: string) => string;
}

export function LibraryFolderDialog({
  open,
  mode,
  folderName,
  folderParentId,
  rootFolderValue,
  parentFolders,
  createPending,
  updatePending,
  onOpenChange,
  onFolderNameChange,
  onFolderParentChange,
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
            {mode === 'edit' ? t('editFolderDescription') : t('createFolderDescription')}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="library-folder-name">
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
          <div className="space-y-2">
            <label className="text-sm font-medium" htmlFor="library-folder-parent">
              {t('parentFolderLabel')}
            </label>
            <Select value={folderParentId} onValueChange={onFolderParentChange}>
              <SelectTrigger id="library-folder-parent">
                <SelectValue placeholder={t('moveTargetPlaceholder')} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={rootFolderValue}>{t('libraryRoot')}</SelectItem>
                {parentFolders.map((folder) => (
                  <SelectItem key={folder.folder_id} value={folder.folder_id}>
                    {folder.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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
