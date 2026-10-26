'use client';

import React from 'react';
import { useTranslations } from 'next-intl';
import { Mic, Pause, Play, Repeat2, Settings, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import type { ContinuousPracticeLifecycle } from '@/lib/practice/continuous/domain/session';
import type { StepControllerState } from '@/lib/practice/step/step-practice-controller';
import type { TempoSegment } from '@/lib/practice/kernel/artifact';
import type { PracticeTempoSelection } from '@/lib/practice/kernel/tempo';
import type { PracticeMicrophoneCapability, PracticeMidiCapability } from '@/lib/practice/input-capability';
import { PracticeTempoPopover } from './practice-tempo-popover';

interface PracticeControlSurfaceProps {
  lifecycle: ContinuousPracticeLifecycle | StepControllerState;
  isLoading: boolean;
  isPreparingSession: boolean;
  canPrepareSession: boolean;
  selectedInputCapability?: PracticeMicrophoneCapability | PracticeMidiCapability;
  audioWorkletSupported?: boolean;
  selectedInputSupported?: boolean;
  rangeSelectionActive: boolean;
  canSelectRange: boolean;
  tempoSelection?: PracticeTempoSelection;
  scoreTempoSegments?: readonly TempoSegment[];
  scopeStartBeat?: number;
  tempoLocked?: boolean;
  onTempoSelectionChange?: (selection: PracticeTempoSelection) => void;
  metronomeEnabled?: boolean;
  onMetronomeEnabledChange?: (enabled: boolean) => void;
  onStart: () => void;
  transportControl?: React.ReactNode;
  onEnd: () => void;
  onOpenSettings: () => void;
  onToggleRangeSelection: () => void;
}

export function StepPracticeControls(props: Omit<PracticeControlSurfaceProps, 'lifecycle' | 'transportControl'> & { lifecycle: StepControllerState }) {
  return <PracticeControlSurface {...props} />;
}

export function ContinuousPracticeControls({ onPause, onResume, ...props }: Omit<PracticeControlSurfaceProps, 'transportControl' | 'lifecycle'> & {
  lifecycle: ContinuousPracticeLifecycle;
  onPause(): void; onResume(): void;
}) {
  const t = useTranslations('practice');
  const paused = props.lifecycle === 'PAUSED';
  return <PracticeControlSurface {...props} transportControl={
    <Button type="button" onClick={paused ? onResume : onPause} size="lg" variant="outline" className="h-11 w-32 bg-white">
      {paused ? <Play className="mr-2 h-4 w-4" /> : <Pause className="mr-2 h-4 w-4" />}
      {t(paused ? 'resume' : 'pause')}
    </Button>
  } />;
}

function PracticeControlSurface({
  lifecycle,
  isLoading,
  isPreparingSession,
  canPrepareSession,
  selectedInputCapability,
  audioWorkletSupported,
  selectedInputSupported,
  rangeSelectionActive,
  canSelectRange,
  tempoSelection,
  scoreTempoSegments,
  scopeStartBeat,
  tempoLocked,
  onTempoSelectionChange,
  metronomeEnabled = false,
  onMetronomeEnabledChange,
  onStart,
  transportControl,
  onEnd,
  onOpenSettings,
  onToggleRangeSelection,
}: PracticeControlSurfaceProps) {
  const t = useTranslations('practice');
  const isActive = lifecycle === 'ACTIVE' || lifecycle === 'PAUSED';
  const isSelectedInputReady = selectedInputCapability
    ? selectedInputCapability.supported
    : (selectedInputSupported ?? audioWorkletSupported ?? true);
  const canStart =
    (lifecycle === 'READY' || lifecycle === 'IDLE' || lifecycle === 'ENDED') &&
    canPrepareSession &&
    !isLoading &&
    !isPreparingSession &&
    isSelectedInputReady;
  const actionButtonClass = 'h-11 w-32';

  return (
    <div className="flex flex-wrap items-center gap-3">
      <div className="flex shrink-0 items-center gap-2">
        {isActive ? transportControl : (
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
              onEnd();
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
          {tempoSelection && onTempoSelectionChange ? (
            <PracticeTempoPopover
              tempoSelection={tempoSelection}
              scoreTempoSegments={scoreTempoSegments}
              scopeStartBeat={scopeStartBeat}
              tempoLocked={tempoLocked ?? isActive}
              onTempoSelectionChange={onTempoSelectionChange}
              metronomeEnabled={metronomeEnabled}
              onMetronomeEnabledChange={onMetronomeEnabledChange}
            />
          ) : null}

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
