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
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import type { LibraryFolderRead } from '@/generated/api';
interface LibraryMoveScoresDialogProps {
  open: boolean;
  count: number;
  pending: boolean;
  t: (key: string, values?: Record<string, string | number>) => string;
  folderId: string;
  rootFolderValue: string;
  folders: LibraryFolderRead[];
  onOpenChange: (open: boolean) => void;
  onFolderChange: (folderId: string) => void;
  onConfirm: () => void;
}
export function LibraryMoveScoresDialog({
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
}: LibraryMoveScoresDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('moveToTitle')}</DialogTitle>
          <DialogDescription>
            {t('moveToDescription', { count })}
          </DialogDescription>
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
              <span className="text-sm text-muted-foreground">
                {folder.score_count}
              </span>
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
