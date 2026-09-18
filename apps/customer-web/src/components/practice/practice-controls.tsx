'use client';

import { useTranslations } from 'next-intl';
import { Hand, Mic, Pause, Play, Repeat2, Settings, Square, Timer } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { LocalPracticeLifecycle } from '@/lib/practice/local-core/session';

interface PracticeControlsProps {
  lifecycle: LocalPracticeLifecycle;
  isLoading: boolean;
  isPreparingSession: boolean;
  canPrepareSession: boolean;
  audioWorkletSupported: boolean;
  rangeSelectionActive: boolean;
  canSelectRange: boolean;
  onStart: () => void;
  onPause: () => void;
  onResume: () => void;
  onFinish: () => void;
  onOpenSettings: () => void;
  onToggleRangeSelection: () => void;
}

export function PracticeControls({
  lifecycle,
  isLoading,
  isPreparingSession,
  canPrepareSession,
  audioWorkletSupported,
  rangeSelectionActive,
  canSelectRange,
  onStart,
  onPause,
  onResume,
  onFinish,
  onOpenSettings,
  onToggleRangeSelection,
}: PracticeControlsProps) {
  const t = useTranslations('practice');
  const isActive = lifecycle === 'ACTIVE' || lifecycle === 'PAUSED';
  const isPaused = lifecycle === 'PAUSED';
  const canStart =
    (lifecycle === 'READY' || lifecycle === 'ENDED') &&
    canPrepareSession &&
    !isLoading &&
    !isPreparingSession &&
    audioWorkletSupported;
  const actionButtonClass = 'h-11 w-32';

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex shrink-0 items-center gap-2">
        {isActive ? (
          <Button
            type="button"
            onClick={isPaused ? onResume : onPause}
            size="lg"
            variant="outline"
            className={cn('bg-white', actionButtonClass)}
          >
            {isPaused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
            {t(isPaused ? 'resume' : 'pause')}
          </Button>
        ) : (
          <Button
            type="button"
            onClick={onStart}
            size="lg"
            disabled={!canStart}
            className={cn('bg-orange-500 font-semibold text-white hover:bg-orange-600', actionButtonClass)}
          >
            <Mic className="mr-2 h-4 w-4" />
            {t('start')}
          </Button>
        )}
        <Button
          type="button"
          onClick={() => {
            if (isActive) {
              onFinish();
            }
          }}
          variant="destructive"
          size="lg"
          disabled={!isActive}
          className={actionButtonClass}
        >
          <Square className="mr-2 h-4 w-4" /> {t('finish')}
        </Button>
      </div>

      <div className="hidden h-8 w-px bg-slate-200 lg:block" aria-hidden="true" />

      <TooltipProvider>
        <div className="flex flex-wrap items-center gap-2">
          <PracticeToolPlaceholder icon={Timer} label={t('toolMetronome')} unavailableLabel={t('toolUnavailable')} />
          <Button
            type="button"
            variant={rangeSelectionActive ? 'default' : 'outline'}
            disabled={!canSelectRange || isActive}
            onClick={onToggleRangeSelection}
            className={cn(
              'h-11 gap-2',
              rangeSelectionActive
                ? 'border-slate-400 bg-slate-200 text-slate-950 hover:bg-slate-300'
                : 'border-slate-200 bg-white text-slate-700 hover:bg-slate-50'
            )}
          >
            <Repeat2 className="h-4 w-4" aria-hidden="true" />
            {t('rangeSelectionStart')}
          </Button>
          <PracticeToolPlaceholder icon={Hand} label={t('toolHands')} unavailableLabel={t('toolUnavailable')} />
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                className="h-11 gap-2 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                onClick={onOpenSettings}
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
                {t('settingsButton')}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('settingsTitle')}</TooltipContent>
          </Tooltip>
        </div>
      </TooltipProvider>
    </div>
  );
}

function PracticeToolPlaceholder({
  icon: Icon,
  label,
  unavailableLabel,
}: {
  icon: React.ElementType;
  label: string;
  unavailableLabel: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          type="button"
          variant="outline"
          disabled
          className="h-11 gap-2 border-slate-200 bg-white text-slate-400"
        >
          <Icon className="h-4 w-4" aria-hidden="true" />
          {label}
        </Button>
      </TooltipTrigger>
      <TooltipContent>{unavailableLabel}</TooltipContent>
    </Tooltip>
  );
}
