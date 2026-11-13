'use client';

import { FolderInput, MoreVertical, Star, Trash2 } from 'lucide-react';
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
import { formatApiDateTime } from '@/lib/date-time';
import { cn } from '@/lib/utils';
import type { LibraryScoreRead } from '@/generated/api';

interface LibraryScoreCardProps {
  score: LibraryScoreRead;
  batchMode: boolean;
  selected: boolean;
  favoritePending: boolean;
  movePending: boolean;
  onOpen: () => void;
  onToggleSelection: (checked: boolean) => void;
  onToggleFavorite: () => void;
  onOpenMoveDialog: () => void;
  onDeleteScore?: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function LibraryScoreCard({
  score,
  batchMode,
  selected,
  favoritePending,
  movePending,
  onOpen,
  onToggleSelection,
  onToggleFavorite,
  onOpenMoveDialog,
  onDeleteScore,
  t,
}: LibraryScoreCardProps) {
  return (
    <Card
      className={cn(
        'group cursor-pointer rounded-2xl transition hover:-translate-y-0.5 hover:shadow-lg',
        selected && 'ring-2 ring-primary',
      )}
      onClick={() => {
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
              aria-label={t('selectScore', { title: score.title })}
            />
          </div>
        ) : null}
        <ScoreThumbnail
          title={score.title}
          thumbnailRenderAssetId={score.derived_assets.preview.asset_id}
          className="mb-4"
        />
        <h3 className="truncate font-semibold">{score.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatApiDateTime(score.updated_at)}
        </p>
        <p className="mt-2 text-xs text-muted-foreground">
          {t(score.access_origin === 'OWNER' ? 'youOwn' : 'sharedWithMe')}
        </p>
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
              <DropdownMenuContent
                align="end"
                onClick={(event) => event.stopPropagation()}
              >
                <DropdownMenuItem
                  disabled={favoritePending}
                  onClick={onToggleFavorite}
                >
                  <Star className="h-4 w-4" />
                  {t(score.is_favorite ? 'unfavorite' : 'favorite')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={movePending}
                  onClick={onOpenMoveDialog}
                >
                  <FolderInput className="h-4 w-4" />
                  {t('moveTo')}
                </DropdownMenuItem>
                {score.access_origin === 'OWNER' && onDeleteScore ? (
                  <DropdownMenuItem
                    className="text-destructive"
                    onClick={onDeleteScore}
                  >
                    <Trash2 className="h-4 w-4" />
                    {t('deleteScore')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
