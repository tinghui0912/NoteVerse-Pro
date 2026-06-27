'use client';

import { FolderInput, MoreVertical, Tags, Trash2 } from 'lucide-react';
import { ScoreThumbnail } from '@/components/score/score-thumbnail';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { formatApiDateTime } from '@/lib/score/metadata-display';
import { cn } from '@/lib/utils';
import type { LibraryEntry, LibraryPracticeState } from '@/types/api';

interface LibraryEntryCardProps {
  entry: LibraryEntry;
  batchMode: boolean;
  selected: boolean;
  updatePending: boolean;
  movePending: boolean;
  practiceStateLabel: (practiceState: LibraryPracticeState) => string;
  onOpen: () => void;
  onToggleSelection: (checked: boolean) => void;
  onOpenPracticeStateDialog: () => void;
  onOpenMoveDialog: () => void;
  onOpenDeleteDialog: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function LibraryEntryCard({
  entry,
  batchMode,
  selected,
  updatePending,
  movePending,
  practiceStateLabel,
  onOpen,
  onToggleSelection,
  onOpenPracticeStateDialog,
  onOpenMoveDialog,
  onOpenDeleteDialog,
  t,
}: LibraryEntryCardProps) {
  return (
    <Card
      className={cn(
        'group cursor-pointer rounded-2xl transition hover:-translate-y-0.5 hover:shadow-lg',
        !entry.available && 'cursor-not-allowed opacity-60',
        selected && 'ring-2 ring-primary'
      )}
      onClick={() => {
        if (!entry.available) return;
        if (batchMode) {
          onToggleSelection(!selected);
          return;
        }
        onOpen();
      }}
    >
      <CardContent className="relative p-5">
        {batchMode ? (
        <div className="mb-3 flex justify-end">
          <Checkbox
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(checked) => onToggleSelection(checked === true)}
            aria-label={t('selectScore', { title: entry.title })}
          />
        </div>
        ) : null}
        <ScoreThumbnail
          title={entry.title}
          thumbnailArtifactId={entry.thumbnail_artifact_id}
          className="mb-4"
        />
        <h3 className="truncate font-semibold">{entry.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatApiDateTime(entry.updated_at)}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            {practiceStateLabel(entry.practice_state)}
          </span>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>{entry.source_type === 'BOOKMARK' ? t('bookmark') : t('libraryEntry')}</span>
          {!entry.available ? <span>{t('unavailable')}</span> : null}
        </div>
        {!batchMode ? (
          <div
            className="absolute bottom-4 right-4 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            onClick={(event) => event.stopPropagation()}
          >
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  aria-label={t('moreActions')}
                  className="h-9 w-9 rounded-full bg-white/95 shadow-md"
                  size="icon"
                  variant="ghost"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
                <DropdownMenuItem disabled={updatePending} onClick={onOpenPracticeStateDialog}>
                  <Tags className="h-4 w-4" />
                  {t('markAs')}
                </DropdownMenuItem>
                <DropdownMenuItem disabled={movePending} onClick={onOpenMoveDialog}>
                  <FolderInput className="h-4 w-4" />
                  {t('moveTo')}
                </DropdownMenuItem>
                <DropdownMenuItem className="text-destructive" onClick={onOpenDeleteDialog}>
                  <Trash2 className="h-4 w-4" />
                  {t('deleteEntry')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
