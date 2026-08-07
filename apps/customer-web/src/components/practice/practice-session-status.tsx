'use client';

import { LoaderCircle, Mic } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { cn } from '@/lib/utils';
import type { PracticeConnectionStatus, PracticeStatus } from '@/lib/practice/practice-types';

type PracticeSessionStatusProps = {
  className?: string;
  status: PracticeStatus;
  connectionStatus: PracticeConnectionStatus;
  isLoading: boolean;
  isPreparingSession: boolean;
  canPrepareSession: boolean;
  audioWorkletSupported: boolean;
  practiceClockStarted: boolean;
  practiceTime: number;
};

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function PracticeSessionStatus({
  className,
  status,
  connectionStatus,
  isLoading,
  isPreparingSession,
  canPrepareSession,
  audioWorkletSupported,
  practiceClockStarted,
  practiceTime,
}: PracticeSessionStatusProps) {
  const t = useTranslations('practice');
  const isPreparing = status === 'connecting' || status === 'arming';
  const isPreparingConnection =
    (status === 'idle' || status === 'finished') &&
    canPrepareSession &&
    audioWorkletSupported &&
    !isLoading &&
    (isPreparingSession || connectionStatus !== 'ready');
  const isRecording =
    practiceClockStarted &&
    (status === 'listening' || status === 'practicing' || status === 'paused');
  const message = isPreparingConnection
    ? t('preparingPractice')
    : isPreparing
      ? t('preparingToPlay')
      : status === 'listening'
        ? t('waitingForFirstNote')
        : status === 'practicing'
          ? t('settingStatusFollowing')
          : status === 'paused'
            ? t('settingStatusPaused')
            : t('settingStatusReady');

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm',
        className
      )}
    >
      {isPreparing || isPreparingConnection ? (
        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-orange-500" aria-hidden="true" />
      ) : (
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full bg-slate-300',
            status === 'listening' || status === 'practicing'
              ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]'
              : status === 'paused'
                ? 'bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.14)]'
                : 'bg-slate-400'
          )}
          aria-hidden="true"
        />
      )}
      <span className="max-w-52 truncate font-medium text-slate-700">{message}</span>
      {isRecording ? (
        <span className="flex shrink-0 items-center gap-1.5 border-l border-slate-200 pl-2.5 font-semibold tabular-nums text-rose-600">
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
          {formatTime(practiceTime)}
        </span>
      ) : null}
    </div>
  );
}
