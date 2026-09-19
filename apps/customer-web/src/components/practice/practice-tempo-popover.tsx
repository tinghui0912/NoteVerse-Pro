'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Gauge, Minus, Plus, RotateCcw } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { TempoSegment } from '@/lib/practice/local-core/artifact';
import {
  MAX_PRACTICE_TEMPO_BPM,
  MIN_PRACTICE_TEMPO_BPM,
  clampCustomTempo,
  effectiveScoreTempoAtBeat,
  type PracticeTempoSelection,
} from '@/lib/practice/local-core/practice-tempo';

export type PracticeTempoPopoverProps = {
  tempoSelection: PracticeTempoSelection;
  scoreTempoSegments?: readonly TempoSegment[];
  scopeStartBeat?: number;
  tempoLocked?: boolean;
  onTempoSelectionChange: (selection: PracticeTempoSelection) => void;
  className?: string;
};

export function PracticeTempoPopover({
  tempoSelection,
  scoreTempoSegments = [],
  scopeStartBeat = 0,
  tempoLocked = false,
  onTempoSelectionChange,
  className,
}: PracticeTempoPopoverProps) {
  const t = useTranslations('practice');

  const effectiveTempo = effectiveScoreTempoAtBeat(scoreTempoSegments, scopeStartBeat);
  const initialBpm = effectiveTempo.bpm;
  const hasExplicit = effectiveTempo.source === 'MUSICXML';
  const isDefaultWithLaterChanges =
    effectiveTempo.source === 'PRODUCT_DEFAULT' && effectiveTempo.hasSubsequentScoreTempoChanges;
  const isMusicXmlWithChanges =
    effectiveTempo.source === 'MUSICXML' && effectiveTempo.hasSubsequentScoreTempoChanges;
  const isMusicXmlSingle =
    effectiveTempo.source === 'MUSICXML' && !effectiveTempo.hasSubsequentScoreTempoChanges;

  // Trigger button label
  const triggerLabel =
    tempoSelection.mode === 'CUSTOM_FIXED_BPM'
      ? `${tempoSelection.bpm} BPM`
      : hasExplicit
        ? t('tempoScoreMode')
        : t('tempoDefaultBpm', { bpm: initialBpm });

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className={cn(
            'h-11 gap-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50',
            className
          )}
          aria-label={t('tempoButton')}
        >
          <Gauge className="h-4 w-4" aria-hidden="true" />
          <span className="tabular-nums">{triggerLabel}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 p-4">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-900">{t('tempoButton')}</h4>
          <span className="text-xs text-slate-400">
            {tempoSelection.mode === 'SCORE' ? t('tempoScoreMode') : t('tempoCustomMode')}
          </span>
        </div>

        <p className="mt-1 text-xs text-slate-500">
          {isDefaultWithLaterChanges
            ? t('tempoOriginalDefaultWithLaterChanges', { bpm: initialBpm })
            : isMusicXmlWithChanges
              ? t('tempoOriginalWithChanges', { bpm: initialBpm })
              : isMusicXmlSingle
                ? t('tempoOriginal', { bpm: initialBpm })
                : t('tempoOriginalDefault')}
        </p>

        {tempoLocked ? (
          <p className="mt-1.5 text-xs font-medium text-amber-600">
            {t('tempoLockedNotice')}
          </p>
        ) : null}

        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            disabled={tempoLocked}
            onClick={() => onTempoSelectionChange({ mode: 'SCORE' })}
            className={cn(
              'flex items-center justify-center rounded-md border py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              tempoSelection.mode === 'SCORE'
                ? 'border-orange-200 bg-orange-50 font-semibold text-orange-950'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            )}
            aria-pressed={tempoSelection.mode === 'SCORE'}
          >
            {hasExplicit ? t('tempoScoreMode') : t('restoreDefaultTempo')}
          </button>
          <button
            type="button"
            disabled={tempoLocked}
            onClick={() => {
              if (tempoSelection.mode === 'SCORE') {
                onTempoSelectionChange({
                  mode: 'CUSTOM_FIXED_BPM',
                  bpm: initialBpm,
                });
              }
            }}
            className={cn(
              'flex items-center justify-center rounded-md border py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60',
              tempoSelection.mode === 'CUSTOM_FIXED_BPM'
                ? 'border-orange-200 bg-orange-50 font-semibold text-orange-950'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            )}
            aria-pressed={tempoSelection.mode === 'CUSTOM_FIXED_BPM'}
          >
            {t('tempoCustomMode')}
          </button>
        </div>

        {tempoSelection.mode === 'CUSTOM_FIXED_BPM' ? (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50/50 p-3">
            <div className="flex items-center justify-between">
              <button
                type="button"
                aria-label="-5 BPM"
                disabled={tempoLocked || tempoSelection.bpm <= MIN_PRACTICE_TEMPO_BPM}
                onClick={() =>
                  onTempoSelectionChange({
                    mode: 'CUSTOM_FIXED_BPM',
                    bpm: clampCustomTempo(tempoSelection.bpm - 5),
                  })
                }
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <span className="text-sm font-semibold tabular-nums text-slate-900">
                {tempoSelection.bpm} BPM
              </span>
              <button
                type="button"
                aria-label="+5 BPM"
                disabled={tempoLocked || tempoSelection.bpm >= MAX_PRACTICE_TEMPO_BPM}
                onClick={() =>
                  onTempoSelectionChange({
                    mode: 'CUSTOM_FIXED_BPM',
                    bpm: clampCustomTempo(tempoSelection.bpm + 5),
                  })
                }
                className="flex h-7 w-7 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>

            <div className="mt-2.5">
              <input
                type="range"
                min={MIN_PRACTICE_TEMPO_BPM}
                max={MAX_PRACTICE_TEMPO_BPM}
                step={1}
                value={tempoSelection.bpm}
                disabled={tempoLocked}
                onChange={(e) =>
                  onTempoSelectionChange({
                    mode: 'CUSTOM_FIXED_BPM',
                    bpm: clampCustomTempo(Number(e.target.value)),
                  })
                }
                aria-label="BPM Slider"
                className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
              />
              <div className="mt-1 flex justify-between text-[10px] text-slate-400">
                <span>{MIN_PRACTICE_TEMPO_BPM}</span>
                <span>{MAX_PRACTICE_TEMPO_BPM}</span>
              </div>
            </div>

            <div className="mt-2 flex justify-center border-t border-slate-200/60 pt-2">
              <button
                type="button"
                disabled={tempoLocked}
                onClick={() => onTempoSelectionChange({ mode: 'SCORE' })}
                className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <RotateCcw className="h-3 w-3" />
                <span>{hasExplicit ? t('restoreOriginalTempo') : t('restoreDefaultTempo')}</span>
              </button>
            </div>
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
