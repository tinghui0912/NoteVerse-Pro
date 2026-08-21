'use client';

import { LoaderCircle, Mic } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useEffect, useState } from 'react';

import { cn } from '@/lib/utils';
import type { PracticeConnectionStatus, PracticeStatus } from '@/lib/practice/practice-types';
import type { PracticeAlignmentUpdateMessage } from '@/lib/practice/protocol';

type PracticeStatusMessageKey =
  | 'preparingPractice'
  | 'preparingToPlay'
  | 'waitingForFirstNote'
  | 'settingStatusFollowing'
  | 'settingStatusPaused'
  | 'settingStatusReady'
  | 'practiceStateHeardUncertain'
  | 'practiceStateWaitingCorrectNote'
  | 'practiceStateFindingPlace';

type PracticeInputHintKey = 'practiceInputCheckMic' | 'practiceInputClipping' | null;

type PracticeSessionStatusView = {
  messageKey: PracticeStatusMessageKey;
  inputHintKey: PracticeInputHintKey;
  pending: boolean;
  uncertain: boolean;
};

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
  alignment?: PracticeAlignmentUpdateMessage['payload'] | null;
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
  alignment,
}: Pick<
  PracticeSessionStatusProps,
  | 'status'
  | 'connectionStatus'
  | 'isLoading'
  | 'isPreparingSession'
  | 'canPrepareSession'
  | 'audioWorkletSupported'
  | 'alignment'
>): PracticeSessionStatusView {
  const isPreparing = status === 'connecting' || status === 'arming';
  const isPreparingConnection =
    (status === 'idle' || status === 'finished') &&
    canPrepareSession &&
    audioWorkletSupported &&
    !isLoading &&
    (isPreparingSession || connectionStatus !== 'ready');

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
  if (alignment.input_peak >= 0.98) {
    return 'practiceInputClipping';
  }
  if (
    alignment.decision.experience_state === 'waiting_for_input' &&
    alignment.input_rms < 0.003
  ) {
    return 'practiceInputCheckMic';
  }
  return null;
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
  alignment,
}: PracticeSessionStatusProps) {
  const t = useTranslations('practice');
  const resolvedView = resolvePracticeSessionStatusView({
    status,
    connectionStatus,
    isLoading,
    isPreparingSession,
    canPrepareSession,
    audioWorkletSupported,
    alignment,
  });
  const [displayView, setDisplayView] = useState(resolvedView);
  const isRecording =
    practiceClockStarted &&
    (status === 'listening' || status === 'practicing' || status === 'paused');

  useEffect(() => {
    if (!resolvedView.uncertain) {
      setDisplayView(resolvedView);
      return undefined;
    }

    const timeoutId = window.setTimeout(() => {
      setDisplayView(resolvedView);
    }, 350);
    return () => window.clearTimeout(timeoutId);
  }, [
    resolvedView.inputHintKey,
    resolvedView.messageKey,
    resolvedView.pending,
    resolvedView.uncertain,
  ]);

  const message = t(displayView.messageKey);

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
