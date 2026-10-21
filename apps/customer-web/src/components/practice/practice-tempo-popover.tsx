'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Gauge, Minus, Plus, RotateCcw, Timer } from 'lucide-react';

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
  metronomeEnabled?: boolean;
  onMetronomeEnabledChange?: (enabled: boolean) => void;
  className?: string;
};

export function PracticeTempoPopover({
  tempoSelection,
  scoreTempoSegments = [],
  scopeStartBeat = 0,
  tempoLocked = false,
  onTempoSelectionChange,
  metronomeEnabled = false,
  onMetronomeEnabledChange,
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

  const currentBpm =
    tempoSelection.mode === 'CUSTOM_FIXED_BPM' ? tempoSelection.bpm : initialBpm;

  // Single trigger label: [速度 · 原速] or [速度 · 80 BPM]
  const triggerLabel =
    tempoSelection.mode === 'CUSTOM_FIXED_BPM'
      ? `${t('tempoButton')} · ${tempoSelection.bpm} BPM`
      : hasExplicit
        ? `${t('tempoButton')} · ${t('tempoScoreMode')}`
        : `${t('tempoButton')} · ${initialBpm} BPM`;

  const handleAdjustBpm = (delta: number) => {
    const nextBpm = clampCustomTempo(currentBpm + delta);
    onTempoSelectionChange({
      mode: 'CUSTOM_FIXED_BPM',
      bpm: nextBpm,
    });
  };

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const nextBpm = clampCustomTempo(Number(e.target.value));
    onTempoSelectionChange({
      mode: 'CUSTOM_FIXED_BPM',
      bpm: nextBpm,
    });
  };

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
        {/* Header */}
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-slate-900">{t('settingsTempoAndMetronome')}</h4>
          <span className="text-xs font-medium text-slate-400">
            {tempoSelection.mode === 'SCORE' ? t('tempoScoreMode') : t('tempoCustomMode')}
          </span>
        </div>

        {/* Score original tempo description */}
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

        {/* BPM Stepper and Display */}
        <div className="mt-3.5 rounded-md border border-slate-200 bg-slate-50/50 p-3">
          <div className="flex items-center justify-between">
            <button
              type="button"
              aria-label="-5 BPM"
              disabled={tempoLocked || currentBpm <= MIN_PRACTICE_TEMPO_BPM}
              onClick={() => handleAdjustBpm(-5)}
              className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Minus className="h-4 w-4" />
            </button>
            <div className="flex flex-col items-center">
              <span className="text-base font-bold tabular-nums text-slate-900">
                {currentBpm} BPM
              </span>
            </div>
            <button
              type="button"
              aria-label="+5 BPM"
              disabled={tempoLocked || currentBpm >= MAX_PRACTICE_TEMPO_BPM}
              onClick={() => handleAdjustBpm(5)}
              className="flex h-8 w-8 items-center justify-center rounded border border-slate-200 bg-white text-slate-700 shadow-sm hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>

          {/* Slider */}
          <div className="mt-3">
            <input
              type="range"
              min={MIN_PRACTICE_TEMPO_BPM}
              max={MAX_PRACTICE_TEMPO_BPM}
              step={1}
              value={currentBpm}
              disabled={tempoLocked}
              onChange={handleSliderChange}
              aria-label="BPM Slider"
              className="h-1.5 w-full cursor-pointer appearance-none rounded-lg bg-slate-200 accent-orange-600 disabled:cursor-not-allowed disabled:opacity-60"
            />
            <div className="mt-1 flex justify-between text-[10px] text-slate-400">
              <span>{MIN_PRACTICE_TEMPO_BPM}</span>
              <span>{MAX_PRACTICE_TEMPO_BPM}</span>
            </div>
          </div>

          {/* Restore Original Tempo */}
          <div className="mt-2.5 flex justify-center border-t border-slate-200/60 pt-2">
            <button
              type="button"
              disabled={tempoLocked || tempoSelection.mode === 'SCORE'}
              onClick={() => onTempoSelectionChange({ mode: 'SCORE' })}
              className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="h-3 w-3" />
              <span>{hasExplicit ? t('restoreOriginalTempo') : t('restoreDefaultTempo')}</span>
            </button>
          </div>
        </div>

        {/* Metronome Sound Toggle - always operable even during practice */}
        <div className="mt-4 flex items-center justify-between border-t border-slate-200/80 pt-3">
          <div className="flex items-center gap-2">
            <Timer className="h-4 w-4 text-slate-500" aria-hidden="true" />
            <span className="text-sm font-medium text-slate-900">{t('metronomeSound')}</span>
          </div>
          <Button
            type="button"
            size="sm"
            variant={metronomeEnabled ? 'default' : 'outline'}
            onClick={() => onMetronomeEnabledChange?.(!metronomeEnabled)}
            className={cn(
              'h-8 px-3 text-xs font-semibold',
              metronomeEnabled
                ? 'border-orange-300 bg-orange-50 text-orange-950 hover:bg-orange-100'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            )}
            aria-pressed={metronomeEnabled}
            aria-label={t('metronomeSound')}
          >
            {metronomeEnabled ? t('metronomeOn') : t('metronomeOff')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
