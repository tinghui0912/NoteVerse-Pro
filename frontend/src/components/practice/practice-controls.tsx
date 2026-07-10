'use client';

import { useRef } from 'react';
import { useTranslations } from 'next-intl';
import { Mic, Pause, Play, Square } from 'lucide-react';
import { InlineLoading } from '@/components/loading/inline-loading';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { PracticeConnectionStatus, PracticeStatus } from '@/lib/practice/practice-types';

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

interface PracticeControlsProps {
  status: PracticeStatus;
  connectionStatus: PracticeConnectionStatus;
  isLoading: boolean;
  isPreparingSession: boolean;
  canPrepareSession: boolean;
  audioWorkletSupported: boolean;
  practiceClockStarted: boolean;
  practiceTime: number;
  onStart: () => void;
  onPause: () => void;
  onFinish: () => void;
}

export function PracticeControls({
  status,
  connectionStatus,
  isLoading,
  isPreparingSession,
  canPrepareSession,
  audioWorkletSupported,
  practiceClockStarted,
  practiceTime,
  onStart,
  onPause,
  onFinish,
}: PracticeControlsProps) {
  const t = useTranslations('practice');
  const pointerHandledRef = useRef<string | null>(null);
  const isPreparing = status === 'connecting' || status === 'arming';
  const isActive = status === 'listening' || status === 'practicing' || status === 'paused';
  const isRecordingVisible =
    practiceClockStarted &&
    (status === 'arming' || status === 'listening' || status === 'practicing' || status === 'paused');
  const isPreparingConnection =
    (status === 'idle' || status === 'finished') &&
    canPrepareSession &&
    audioWorkletSupported &&
    !isLoading &&
    (isPreparingSession || connectionStatus !== 'ready');
  const canStart =
    (status === 'idle' || status === 'finished') &&
    canPrepareSession &&
    !isLoading &&
    !isPreparingSession &&
    connectionStatus === 'ready' &&
    audioWorkletSupported;
  const actionButtonClass = 'h-11 min-w-[8.5rem]';

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
    <div className="flex flex-wrap items-center justify-end gap-2">
      {isPreparingConnection && (
        <div className="flex items-center gap-2 rounded-full bg-muted px-3 py-2 text-sm font-medium text-muted-foreground">
          <InlineLoading label={t('preparingPractice')} />
        </div>
      )}
      {isPreparing && (
        <div className="flex items-center gap-2 rounded-full bg-orange-100 px-3 py-2 text-sm font-medium text-orange-700">
          <InlineLoading label={t('preparingToPlay')} />
        </div>
      )}
      {status === 'listening' && (
        <div className="flex items-center gap-2 rounded-full bg-orange-100 px-3 py-2 text-sm font-medium text-orange-700">
          <Mic className="h-4 w-4 animate-pulse" />
          <span>{t('waitingForFirstNote')}</span>
        </div>
      )}
      {isRecordingVisible && (
        <div className="flex items-center gap-2 rounded-full bg-destructive/90 px-3 py-2 text-sm font-medium text-destructive-foreground">
          <Mic className={cn('h-4 w-4', status === 'practicing' && 'animate-pulse')} />
          <span>{t('recordingDuration', { time: formatTime(practiceTime) })}</span>
        </div>
      )}
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
  );
}
