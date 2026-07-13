'use client';

import { MoreVertical, Trash2 } from 'lucide-react';
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
import type { MyScoresView, ScoreDetail } from '@/types/api';

function stateLabelKey(view: MyScoresView) {
  if (view === 'published') return 'publishedStatus';
  return 'privateStatus';
}

interface MyScoreCardProps {
  score: ScoreDetail;
  view: MyScoresView;
  batchMode: boolean;
  selected: boolean;
  onOpen: () => void;
  onToggleSelection: () => void;
  onDelete: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function MyScoreCard({
  score,
  view,
  batchMode,
  selected,
  onOpen,
  onToggleSelection,
  onDelete,
  t,
}: MyScoreCardProps) {
  const labelKey =
    score.publication?.status === 'PUBLISHED'
      ? 'publishedStatus'
      : stateLabelKey(view);
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
          <span
            className={cn(
              'rounded-full px-2 py-1 text-xs',
              score.publication?.status === 'PUBLISHED'
                  ? 'bg-green-100 text-green-700'
                : 'bg-primary/10 text-primary'
            )}
          >
            {t(labelKey)}
          </span>
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
