'use client';

import { useRef } from 'react';
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
import type { PracticeConnectionStatus, PracticeStatus } from '@/lib/practice/practice-types';

interface PracticeControlsProps {
  status: PracticeStatus;
  connectionStatus: PracticeConnectionStatus;
  isLoading: boolean;
  isPreparingSession: boolean;
  canPrepareSession: boolean;
  audioWorkletSupported: boolean;
  rangeSelectionActive: boolean;
  canSelectRange: boolean;
  onStart: () => void;
  onPause: () => void;
  onFinish: () => void;
  onOpenSettings: () => void;
  onToggleRangeSelection: () => void;
}

export function PracticeControls({
  status,
  connectionStatus,
  isLoading,
  isPreparingSession,
  canPrepareSession,
  audioWorkletSupported,
  rangeSelectionActive,
  canSelectRange,
  onStart,
  onPause,
  onFinish,
  onOpenSettings,
  onToggleRangeSelection,
}: PracticeControlsProps) {
  const t = useTranslations('practice');
  const pointerHandledRef = useRef<string | null>(null);
  const isActive = status === 'listening' || status === 'practicing' || status === 'paused';
  const canStart =
    (status === 'idle' || status === 'finished') &&
    canPrepareSession &&
    !isLoading &&
    !isPreparingSession &&
    (connectionStatus === 'ready' || connectionStatus === 'disconnected' || connectionStatus === 'error') &&
    audioWorkletSupported;
  const actionButtonClass = 'h-11 w-32';

  const runPointerControl = (
    event: React.PointerEvent<HTMLButtonElement>,
    control: string,
    action: () => void
  ) => {
    event.preventDefault();
    pointerHandledRef.current = control;
    action();
  };

  const runClickControl = (control: string, action: () => void) => {
    if (pointerHandledRef.current === control) {
      pointerHandledRef.current = null;
      return;
    }
    action();
  };

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex shrink-0 items-center gap-2">
        {isActive ? (
          <Button
            type="button"
            onPointerDown={(event) => runPointerControl(event, 'pause', onPause)}
            onClick={() => runClickControl('pause', onPause)}
            size="lg"
            variant="outline"
            className={cn('bg-white', actionButtonClass)}
          >
            {status === 'paused' ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
            {t(status === 'paused' ? 'resume' : 'pause')}
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
          onPointerDown={(event) => isActive && runPointerControl(event, 'finish', onFinish)}
          onClick={() => isActive && runClickControl('finish', onFinish)}
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
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="outline"
                size="icon"
                className="h-11 w-11 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-950"
                onClick={onOpenSettings}
                aria-label={t('settingsTitle')}
              >
                <Settings className="h-4 w-4" aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('settingsTitle')}</TooltipContent>
          </Tooltip>
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
  icon: typeof Timer;
  label: string;
  unavailableLabel: string;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span>
          <button
            type="button"
            disabled
            className="flex h-11 items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 text-sm font-medium text-slate-500 disabled:cursor-not-allowed"
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {label}
          </button>
        </span>
      </TooltipTrigger>
      <TooltipContent>{unavailableLabel}</TooltipContent>
    </Tooltip>
  );
}
