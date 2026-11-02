'use client';

import { Library, MoreVertical, Trash2 } from 'lucide-react';
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
import type { ScoreRead } from '@/generated/api';

interface MyScoreCardProps {
  score: ScoreRead;
  batchMode: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleSelection: () => void;
  onAddToLibrary: () => void;
  onDelete: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function MyScoreCard({
  score,
  batchMode,
  selected,
  onOpen,
  onToggleSelection,
  onAddToLibrary,
  onDelete,
  t,
}: MyScoreCardProps) {
  return (
    <Card
      className={cn(
        'group cursor-pointer rounded-2xl transition hover:-translate-y-0.5 hover:shadow-lg',
        selected && 'ring-2 ring-primary'
      )}
      onClick={() => {
        if (batchMode) {
          onToggleSelection();
          return;
        }
        onOpen();
      }}
    >
      <CardContent className="relative p-5">
        {batchMode ? (
          <div
            className="absolute left-4 top-4 z-10 rounded-md bg-white/90 p-1 shadow-sm"
            onClick={(event) => event.stopPropagation()}
          >
            <Checkbox
              checked={selected}
              onCheckedChange={onToggleSelection}
              aria-label={t('selectScore', { title: score.title })}
            />
          </div>
        ) : null}
        <ScoreThumbnail
          title={score.title}
          thumbnailRenderAssetId={score.derived_assets.preview.asset_id}
          className="mb-4"
        />
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="truncate font-semibold">{score.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {formatApiDateTime(score.updated_at)}
            </p>
          </div>
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
              <DropdownMenuContent align="end">
                {!score.in_library ? (
                  <DropdownMenuItem onClick={onAddToLibrary}>
                    <Library className="h-4 w-4" />
                    {t('addToLibrary')}
                  </DropdownMenuItem>
                ) : null}
                <DropdownMenuItem className="text-destructive" onClick={onDelete}>
                  <Trash2 className="h-4 w-4" />
                  {t('delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
