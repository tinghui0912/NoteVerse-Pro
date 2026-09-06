'use client';

import { LoaderCircle, Mic } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useMemo, useState } from 'react';

import { cn } from '@/lib/utils';
import type { PracticeSessionMode } from '@/lib/practice/session-policy';
import type { PracticeConnectionStatus, PracticeStatus } from '@/lib/practice/practice-types';
import type {
  PracticeAlignmentUpdateMessage,
  PracticePerformanceClockPayload,
} from '@/lib/practice/protocol';

type PracticeStatusMessageKey =
  | 'preparingPractice'
  | 'preparingToPlay'
  | 'performanceCountIn'
  | 'performanceStarting'
  | 'performanceRunning'
  | 'finishingPractice'
  | 'waitingForFirstNote'
  | 'settingStatusFollowing'
  | 'settingStatusPaused'
  | 'settingStatusReady'
  | 'practiceStateHeardUncertain'
  | 'practiceStatePartiallyMatched'
  | 'practiceStateWaitingCorrectNote'
  | 'practiceStateFindingPlace';

type PracticeInputHintKey =
  | 'practiceInputCheckMic'
  | 'practiceInputClipping'
  | 'practiceInputNoiseElevated'
  | 'practiceInputNoiseHigh'
  | null;

type PracticeSessionStatusView = {
  messageKey: PracticeStatusMessageKey;
  inputHintKey: PracticeInputHintKey;
  pending: boolean;
  uncertain: boolean;
};

const UNCERTAIN_STATUS_DELAY_MS = 350;
const COUNT_IN_STATUS_TICK_MS = 100;

type PracticeSessionStatusProps = {
  className?: string;
  status: PracticeStatus;
  connectionStatus: PracticeConnectionStatus;
  isLoading: boolean;
  isPreparingSession: boolean;
  canPrepareSession: boolean;
  audioWorkletSupported: boolean;
  sessionMode: PracticeSessionMode;
  practiceClockStarted: boolean;
  practiceTime: number;
  alignment?: PracticeAlignmentUpdateMessage['payload'] | null;
  performanceClockSync?: PracticePerformanceClockPayload | null;
  performanceClockSyncReceivedAtMs?: number | null;
};

function formatTime(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

export function resolvePracticeSessionStatusView({
  status,
  connectionStatus,
  isLoading,
  isPreparingSession,
  canPrepareSession,
  audioWorkletSupported,
  sessionMode,
  alignment,
  performanceClockSync,
}: Pick<
  PracticeSessionStatusProps,
  | 'status'
  | 'connectionStatus'
  | 'isLoading'
  | 'isPreparingSession'
  | 'canPrepareSession'
  | 'audioWorkletSupported'
  | 'sessionMode'
  | 'alignment'
  | 'performanceClockSync'
>): PracticeSessionStatusView {
  const isPreparing = status === 'connecting' || status === 'arming';
  const isPreparingConnection =
    (status === 'idle' || status === 'finished') &&
    canPrepareSession &&
    audioWorkletSupported &&
    !isLoading &&
    (isPreparingSession || connectionStatus === 'connecting');

  if (isPreparingConnection) {
    return {
      messageKey: 'preparingPractice',
      inputHintKey: null,
      pending: true,
      uncertain: false,
    };
  }

  if (isPreparing) {
    return {
      messageKey: 'preparingToPlay',
      inputHintKey: null,
      pending: true,
      uncertain: false,
    };
  }

  if (status === 'finishing') {
    return {
      messageKey: 'finishingPractice',
      inputHintKey: null,
      pending: true,
      uncertain: false,
    };
  }

  if (status === 'paused') {
    return {
      messageKey: 'settingStatusPaused',
      inputHintKey: null,
      pending: false,
      uncertain: false,
    };
  }

  if (status !== 'listening' && status !== 'practicing') {
    return {
      messageKey: 'settingStatusReady',
      inputHintKey: null,
      pending: false,
      uncertain: false,
    };
  }

  if (sessionMode === 'CONTINUOUS_PLAY' && performanceClockSync?.state === 'COUNT_IN') {
    return {
      messageKey: 'performanceCountIn',
      inputHintKey: null,
      pending: false,
      uncertain: false,
    };
  }

  if (sessionMode === 'CONTINUOUS_PLAY' && status === 'practicing') {
    return {
      messageKey: 'performanceRunning',
      inputHintKey: null,
      pending: false,
      uncertain: false,
    };
  }

  const experienceState = alignment?.decision.experience_state;
  const inputHintKey = inputHintForAlignment(alignment);

  if (experienceState === 'following') {
    return {
      messageKey: 'settingStatusFollowing',
      inputHintKey,
      pending: false,
      uncertain: false,
    };
  }

  if (experienceState === 'heard_but_uncertain') {
    return {
      messageKey: 'practiceStateHeardUncertain',
      inputHintKey,
      pending: false,
      uncertain: true,
    };
  }

  if (experienceState === 'partially_matched') {
    return {
      messageKey: 'practiceStatePartiallyMatched',
      inputHintKey,
      pending: false,
      uncertain: false,
    };
  }

  if (experienceState === 'possible_wrong_note') {
    return {
      messageKey: 'practiceStateWaitingCorrectNote',
      inputHintKey,
      pending: false,
      uncertain: true,
    };
  }

  if (experienceState === 'recovering' || experienceState === 'lost') {
    return {
      messageKey: 'practiceStateFindingPlace',
      inputHintKey,
      pending: false,
      uncertain: true,
    };
  }

  return {
    messageKey: 'waitingForFirstNote',
    inputHintKey,
    pending: false,
    uncertain: false,
  };
}

function inputHintForAlignment(
  alignment: PracticeAlignmentUpdateMessage['payload'] | null | undefined
): PracticeInputHintKey {
  if (!alignment) {
    return null;
  }
  if (!alignment.input_health.available || alignment.input_health.level === 'too_quiet') {
    return 'practiceInputCheckMic';
  }
  if (alignment.input_health.level === 'clipping') {
    return 'practiceInputClipping';
  }
  if (alignment.input_health.noise === 'high') {
    return 'practiceInputNoiseHigh';
  }
  if (alignment.input_health.noise === 'elevated') {
    return 'practiceInputNoiseElevated';
  }
  return null;
}

function fallbackViewBeforeUncertainState(status: PracticeStatus): PracticeSessionStatusView {
  return {
    messageKey: status === 'listening' ? 'waitingForFirstNote' : 'settingStatusFollowing',
    inputHintKey: null,
    pending: false,
    uncertain: false,
  };
}

function isSameStatusView(
  left: PracticeSessionStatusView | null,
  right: PracticeSessionStatusView
): left is PracticeSessionStatusView {
  return (
    left?.messageKey === right.messageKey &&
    left.inputHintKey === right.inputHintKey &&
    left.pending === right.pending &&
    left.uncertain === right.uncertain
  );
}

export function PracticeSessionStatus({
  className,
  status,
  connectionStatus,
  isLoading,
  isPreparingSession,
  canPrepareSession,
  audioWorkletSupported,
  sessionMode,
  practiceClockStarted,
  practiceTime,
  alignment,
  performanceClockSync,
  performanceClockSyncReceivedAtMs = null,
}: PracticeSessionStatusProps) {
  const t = useTranslations('practice');
  const resolvedView = useMemo(
    () =>
      resolvePracticeSessionStatusView({
        status,
        connectionStatus,
        isLoading,
        isPreparingSession,
        canPrepareSession,
        audioWorkletSupported,
        sessionMode,
        alignment,
        performanceClockSync,
      }),
    [
      alignment,
      audioWorkletSupported,
      canPrepareSession,
      connectionStatus,
      isLoading,
      isPreparingSession,
      performanceClockSync,
      sessionMode,
      status,
    ]
  );
  const [delayedUncertainView, setDelayedUncertainView] =
    useState<PracticeSessionStatusView | null>(null);
  const [countInNowMs, setCountInNowMs] = useState(0);
  const isRecording =
    practiceClockStarted &&
    (status === 'listening' || status === 'practicing' || status === 'paused');

  useEffect(() => {
    if (!resolvedView.uncertain) {
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setDelayedUncertainView(resolvedView);
    }, UNCERTAIN_STATUS_DELAY_MS);
    return () => window.clearTimeout(timeoutId);
  }, [
    resolvedView,
  ]);

  useEffect(() => {
    if (performanceClockSync?.state !== 'COUNT_IN') {
      return undefined;
    }

    const intervalId = window.setInterval(() => {
      setCountInNowMs(performance.now());
    }, COUNT_IN_STATUS_TICK_MS);
    return () => window.clearInterval(intervalId);
  }, [performanceClockSync]);

  const displayView =
    resolvedView.uncertain && isSameStatusView(delayedUncertainView, resolvedView)
      ? delayedUncertainView
      : resolvedView.uncertain
        ? fallbackViewBeforeUncertainState(status)
        : resolvedView;
  const projectedCountInRemainingMs =
    displayView.messageKey === 'performanceCountIn' &&
    performanceClockSync?.state === 'COUNT_IN' &&
    performanceClockSyncReceivedAtMs !== null
      ? Math.max(
          0,
          performanceClockSync.count_in_remaining_ms -
            Math.max(0, countInNowMs - performanceClockSyncReceivedAtMs)
        )
      : null;
  const projectedCountInRemainingPulses =
    projectedCountInRemainingMs !== null &&
    performanceClockSync?.state === 'COUNT_IN' &&
    performanceClockSync.count_in_remaining_ms > 0
      ? Math.max(
          0,
          performanceClockSync.count_in_remaining_pulses *
            (projectedCountInRemainingMs / performanceClockSync.count_in_remaining_ms)
        )
      : null;
  const countInPulse =
    projectedCountInRemainingPulses !== null && projectedCountInRemainingPulses > 0
      ? Math.max(1, Math.ceil(projectedCountInRemainingPulses))
      : null;
  const message =
    displayView.messageKey === 'performanceCountIn' && countInPulse === null
      ? t('performanceStarting')
      : countInPulse === null
      ? t(displayView.messageKey)
      : t(displayView.messageKey, { pulse: countInPulse });

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm',
        className
      )}
    >
      {displayView.pending ? (
        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-orange-500" aria-hidden="true" />
      ) : (
        <span
          className={cn(
            'h-2 w-2 shrink-0 rounded-full bg-slate-300',
            displayView.uncertain
              ? 'bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.14)]'
              : status === 'listening' || status === 'practicing'
              ? 'bg-emerald-500 shadow-[0_0_0_3px_rgba(16,185,129,0.12)]'
              : status === 'paused'
                ? 'bg-amber-400 shadow-[0_0_0_3px_rgba(251,191,36,0.14)]'
                : 'bg-slate-400'
          )}
          aria-hidden="true"
        />
      )}
      <span className="min-w-0 max-w-52 truncate font-medium text-slate-700">{message}</span>
      {displayView.inputHintKey ? (
        <span className="hidden min-w-0 max-w-44 truncate border-l border-slate-200 pl-2 text-xs text-slate-500 sm:inline">
          {t(displayView.inputHintKey)}
        </span>
      ) : null}
      {isRecording ? (
        <span className="flex shrink-0 items-center gap-1.5 border-l border-slate-200 pl-2.5 font-semibold tabular-nums text-rose-600">
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
          {formatTime(practiceTime)}
        </span>
      ) : null}
    </div>
  );
}
