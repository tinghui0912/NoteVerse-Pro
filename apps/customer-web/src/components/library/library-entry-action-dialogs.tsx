'use client';

import { Trash2 } from 'lucide-react';
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
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { LibraryFolder, LibraryPracticeState, UserSettableLibraryPracticeState } from '@/types/api';

interface SharedDialogProps {
  count: number;
  pending: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
}

interface LibraryPracticeStateDialogProps extends SharedDialogProps {
  open: boolean;
  value: UserSettableLibraryPracticeState;
  onOpenChange: (open: boolean) => void;
  onValueChange: (value: UserSettableLibraryPracticeState) => void;
  onConfirm: () => void;
}

interface LibraryMoveEntriesDialogProps extends SharedDialogProps {
  open: boolean;
  folderId: string;
  rootFolderValue: string;
  folders: LibraryFolder[];
  onOpenChange: (open: boolean) => void;
  onFolderChange: (folderId: string) => void;
  onConfirm: () => void;
}

interface LibraryDeleteEntriesDialogProps extends SharedDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

const practiceStateOptions: UserSettableLibraryPracticeState[] = [
  'TO_PRACTICE',
  'MASTERED',
];

function practiceStateLabel(
  value: LibraryPracticeState,
  t: (key: string, values?: Record<string, string | number>) => string
) {
  return {
    TO_PRACTICE: t('practiceStateToPractice'),
    IN_PROGRESS: t('practiceStateInProgress'),
    MASTERED: t('practiceStateMastered'),
  }[value];
}

export function LibraryPracticeStateDialog({
  open,
  count,
  value,
  pending,
  onOpenChange,
  onValueChange,
  onConfirm,
  t,
}: LibraryPracticeStateDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('markAsTitle')}</DialogTitle>
          <DialogDescription>{t('markAsDescription', { count })}</DialogDescription>
        </DialogHeader>
        <RadioGroup
          className="grid gap-3"
          value={value}
          onValueChange={(next) => onValueChange(next as UserSettableLibraryPracticeState)}
        >
          {practiceStateOptions.map((option) => (
            <Label
              key={option}
              className="flex cursor-pointer items-center gap-3 rounded-xl border px-4 py-3"
              htmlFor={`library-practice-${option}`}
            >
              <RadioGroupItem id={`library-practice-${option}`} value={option} />
              <span className="font-medium">{practiceStateLabel(option, t)}</span>
            </Label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={pending || count === 0}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LibraryMoveEntriesDialog({
  open,
  count,
  folderId,
  rootFolderValue,
  folders,
  pending,
  onOpenChange,
  onFolderChange,
  onConfirm,
  t,
}: LibraryMoveEntriesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('moveToTitle')}</DialogTitle>
          <DialogDescription>{t('moveToDescription', { count })}</DialogDescription>
        </DialogHeader>
        <RadioGroup
          className="max-h-[360px] overflow-y-auto rounded-2xl border p-2"
          value={folderId}
          onValueChange={onFolderChange}
        >
          <Label
            className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 hover:bg-muted"
            htmlFor="library-move-root"
          >
            <RadioGroupItem id="library-move-root" value={rootFolderValue} />
            <span className="flex-1 font-medium">{t('libraryRoot')}</span>
          </Label>
          {folders.map((folder) => (
            <Label
              key={folder.folder_id}
              className="flex cursor-pointer items-center gap-3 rounded-xl px-3 py-3 hover:bg-muted"
              htmlFor={`library-move-${folder.folder_id}`}
            >
              <RadioGroupItem
                id={`library-move-${folder.folder_id}`}
                value={folder.folder_id}
              />
              <span className="flex-1 font-medium">{folder.name}</span>
              <span className="text-sm text-muted-foreground">{folder.recursive_count}</span>
            </Label>
          ))}
        </RadioGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('cancel')}
          </Button>
          <Button onClick={onConfirm} disabled={pending || count === 0}>
            {t('confirm')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function LibraryDeleteEntriesDialog({
  open,
  count,
  pending,
  onOpenChange,
  onConfirm,
  t,
}: LibraryDeleteEntriesDialogProps) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('deleteEntriesTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('deleteEntriesDescription', { count })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('cancel')}</AlertDialogCancel>
          <AlertDialogAction
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            disabled={pending || count === 0}
            onClick={onConfirm}
          >
            <Trash2 className="mr-2 h-4 w-4" />
            {t('deleteEntry')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

