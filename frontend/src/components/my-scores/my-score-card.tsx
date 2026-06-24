'use client';

import { Edit, Music } from 'lucide-react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { formatApiDateTime } from '@/lib/score/metadata-display';
import { cn } from '@/lib/utils';
import type { MyScoresView, ScoreDetail, ScoreState } from '@/types/api';

function stateLabelKey(state: ScoreState, view: MyScoresView) {
  if (view === 'published') return 'publishedStatus';
  if (state === 'IN_REVIEW') return 'draftStatus';
  if (state === 'ARCHIVED') return 'archivedStatus';
  return 'privateStatus';
}

interface MyScoreCardProps {
  score: ScoreDetail;
  view: MyScoresView;
  selected: boolean;
  onOpen: () => void;
  onToggleSelection: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function MyScoreCard({
  score,
  view,
  selected,
  onOpen,
  onToggleSelection,
  t,
}: MyScoreCardProps) {
  return (
    <Card
      className={cn(
        'cursor-pointer rounded-2xl transition hover:-translate-y-0.5 hover:shadow-lg',
        selected && 'ring-2 ring-primary'
      )}
      onClick={onOpen}
    >
      <CardContent className="relative p-5">
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
        <div className="mb-4 flex h-32 items-center justify-center rounded-xl bg-muted">
          <Music className="h-10 w-10 text-muted-foreground" />
        </div>
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
              score.state === 'IN_REVIEW'
                ? 'bg-amber-100 text-amber-700'
                : 'bg-primary/10 text-primary'
            )}
          >
            {t(stateLabelKey(score.state, view))}
          </span>
        </div>
        <div className="mt-4 flex gap-2">
          <Button asChild size="sm" variant="outline" onClick={(event) => event.stopPropagation()}>
            <Link
              href={`/editor/${score.score_id}?returnUrl=${encodeURIComponent(`/results/${score.score_id}?from=my-scores`)}`}
            >
              <Edit className="mr-2 h-4 w-4" />
              {t('edit')}
            </Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
