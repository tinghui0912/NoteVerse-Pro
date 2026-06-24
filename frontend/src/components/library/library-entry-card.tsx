'use client';

import { CheckCircle2, Clock3, Music, Target } from 'lucide-react';
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
  selected: boolean;
  updatePending: boolean;
  practiceStateLabel: (practiceState: LibraryPracticeState) => string;
  onOpen: () => void;
  onToggleSelection: (checked: boolean) => void;
  onUpdatePracticeState: (practiceState: LibraryPracticeState) => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}

export function LibraryEntryCard({
  entry,
  selected,
  updatePending,
  practiceStateLabel,
  onOpen,
  onToggleSelection,
  onUpdatePracticeState,
  t,
}: LibraryEntryCardProps) {
  return (
    <Card
      className={cn(
        'cursor-pointer rounded-2xl transition hover:-translate-y-0.5 hover:shadow-lg',
        !entry.available && 'cursor-not-allowed opacity-60'
      )}
      onClick={() => entry.available && onOpen()}
    >
      <CardContent className="p-5">
        <div className="mb-3 flex justify-end">
          <Checkbox
            checked={selected}
            onClick={(event) => event.stopPropagation()}
            onCheckedChange={(checked) => onToggleSelection(checked === true)}
            aria-label={t('selectScore', { title: entry.title })}
          />
        </div>
        <div className="mb-4 flex h-32 items-center justify-center rounded-xl bg-muted">
          <Music className="h-10 w-10 text-muted-foreground" />
        </div>
        <h3 className="truncate font-semibold">{entry.title}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatApiDateTime(entry.updated_at)}
        </p>
        <div className="mt-3 flex items-center justify-between gap-2">
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">
            {practiceStateLabel(entry.practice_state)}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                disabled={updatePending}
                onClick={(event) => event.stopPropagation()}
              >
                {t('changePracticeState')}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem onClick={() => onUpdatePracticeState('TO_PRACTICE')}>
                <Target className="h-4 w-4" />
                {t('practiceStateToPractice')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onUpdatePracticeState('IN_PROGRESS')}>
                <Clock3 className="h-4 w-4" />
                {t('practiceStateInProgress')}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => onUpdatePracticeState('MASTERED')}>
                <CheckCircle2 className="h-4 w-4" />
                {t('practiceStateMastered')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="mt-3 flex items-center justify-between text-xs text-muted-foreground">
          <span>{entry.source_type === 'BOOKMARK' ? t('bookmark') : t('libraryEntry')}</span>
          {!entry.available ? <span>{t('unavailable')}</span> : null}
        </div>
      </CardContent>
    </Card>
  );
}
