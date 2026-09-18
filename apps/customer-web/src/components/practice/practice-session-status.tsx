'use client';

import { LoaderCircle, Mic } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { PracticeMode } from '@/lib/practice/local-core/artifact';
import type { PerformanceClockSnapshot } from '@/lib/practice/local-core/performance-runtime';
import type { LocalPracticeLifecycle, LocalPracticeInputState } from '@/lib/practice/local-core/session';

type PracticeStatusMessageKey =
  | 'preparingPractice'
  | 'performanceCountIn'
  | 'performanceStarting'
  | 'performanceRunning'
  | 'finishingPractice'
  | 'waitingForFirstNote'
  | 'settingStatusFollowing'
  | 'settingStatusPaused'
  | 'settingStatusReady';

export type PracticeSessionStatusView = {
  messageKey: PracticeStatusMessageKey;
  pending: boolean;
  countInPulse: number | null;
};

export type PracticeSessionStatusProps = {
  className?: string;
  lifecycle: LocalPracticeLifecycle;
  inputState?: LocalPracticeInputState;
  isLoading?: boolean;
  sessionMode: PracticeMode;
  practiceTime: number;
  performanceClock?: PerformanceClockSnapshot | null;
};

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function resolvePracticeSessionStatusView({
  lifecycle,
  inputState = 'IDLE',
  sessionMode,
  performanceClock,
}: {
  lifecycle: LocalPracticeLifecycle;
  inputState?: LocalPracticeInputState;
  sessionMode: PracticeMode;
  performanceClock?: PerformanceClockSnapshot | null;
}): PracticeSessionStatusView {
  if (inputState === 'STARTING') {
    return {
      messageKey: 'preparingPractice',
      pending: true,
      countInPulse: null,
    };
  }

  if (lifecycle === 'PAUSED') {
    return {
      messageKey: 'settingStatusPaused',
      pending: false,
      countInPulse: null,
    };
  }

  if (lifecycle !== 'ACTIVE') {
    return {
      messageKey: 'settingStatusReady',
      pending: false,
      countInPulse: null,
    };
  }

  if (sessionMode === 'CONTINUOUS_PLAY' && performanceClock?.state === 'COUNT_IN') {
    return {
      messageKey: 'performanceCountIn',
      pending: false,
      countInPulse: performanceClock.countInPulse,
    };
  }

  if (sessionMode === 'CONTINUOUS_PLAY') {
    return {
      messageKey: 'performanceRunning',
      pending: false,
      countInPulse: null,
    };
  }

  return {
    messageKey: 'waitingForFirstNote',
    pending: false,
    countInPulse: null,
  };
}

export function PracticeSessionStatus({
  className,
  lifecycle,
  inputState = 'IDLE',
  sessionMode,
  practiceTime,
  performanceClock,
}: PracticeSessionStatusProps) {
  const t = useTranslations('practice');
  const resolvedView = useMemo(
    () =>
      resolvePracticeSessionStatusView({
        lifecycle,
        inputState,
        sessionMode,
        performanceClock,
      }),
    [inputState, lifecycle, performanceClock, sessionMode]
  );

  const isRecording = lifecycle === 'ACTIVE' || lifecycle === 'PAUSED';

  const message =
    resolvedView.countInPulse !== null
      ? t('performanceCountIn', { pulse: resolvedView.countInPulse })
      : t(resolvedView.messageKey);

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm',
        className
      )}
    >
      {resolvedView.pending ? (
        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-orange-500" aria-hidden="true" />
      ) : (
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full',
            lifecycle === 'ACTIVE'
              ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]'
              : lifecycle === 'PAUSED'
                ? 'bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.14)]'
                : 'bg-slate-400'
          )}
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 max-w-52 truncate font-medium text-slate-700">{message}</span>
      {isRecording ? (
        <span className="flex shrink-0 items-center gap-1.5 border-l border-slate-200 pl-2.5 font-semibold tabular-nums text-rose-600">
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
          {formatTime(practiceTime)}
        </span>
      ) : null}
    </div>
  );
}
