'use client';

import { AlertCircle, LoaderCircle, Mic } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo } from 'react';

import { cn } from '@/lib/utils';
import type { PracticeInputSource, PracticeMode } from '@/lib/practice/local-core/artifact';
import type { PerformanceClockSnapshot } from '@/lib/practice/local-core/performance-runtime';
import type { LocalPracticeLifecycle, LocalPracticeInputState } from '@/lib/practice/local-core/session';
import type { PracticeMicrophoneCapability, PracticeMidiCapability } from '@/lib/practice/input-capability';

type PracticeStatusMessageKey =
  | 'preparingPractice'
  | 'performanceCountIn'
  | 'performanceStarting'
  | 'performanceRunning'
  | 'finishingPractice'
  | 'waitingForFirstNote'
  | 'settingStatusFollowing'
  | 'settingStatusPaused'
  | 'settingStatusReady'
  | 'micStartFailed'
  | 'midiStartFailed'
  | 'micModelNotConfigured'
  | 'micBrowserUnsupported'
  | 'midiBrowserUnsupported'
  | 'midiNoConnectedInput';

export type PracticeSessionStatusView = {
  messageKey?: PracticeStatusMessageKey;
  customMessage?: string;
  isError?: boolean;
  pending: boolean;
  countInPulse: number | null;
};

export type PracticeSessionStatusProps = {
  className?: string;
  lifecycle: LocalPracticeLifecycle;
  inputState?: LocalPracticeInputState;
  inputError?: string | null;
  inputSource?: PracticeInputSource;
  selectedInputCapability?: PracticeMicrophoneCapability | PracticeMidiCapability;
  rangePrompt?: string | null;
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
  inputError = null,
  inputSource = 'MICROPHONE',
  selectedInputCapability,
  rangePrompt = null,
  sessionMode,
  performanceClock,
}: {
  lifecycle: LocalPracticeLifecycle;
  inputState?: LocalPracticeInputState;
  inputError?: string | null;
  inputSource?: PracticeInputSource;
  selectedInputCapability?: PracticeMicrophoneCapability | PracticeMidiCapability;
  rangePrompt?: string | null;
  sessionMode: PracticeMode;
  performanceClock?: PerformanceClockSnapshot | null;
}): PracticeSessionStatusView {
  if (inputState === 'ERROR') {
    if (inputError === 'NO_CONNECTED_INPUT') {
      return {
        messageKey: 'midiNoConnectedInput',
        isError: true,
        pending: false,
        countInPulse: null,
      };
    }
    return {
      messageKey: inputSource === 'MIDI' ? 'midiStartFailed' : 'micStartFailed',
      customMessage: inputError ?? undefined,
      isError: true,
      pending: false,
      countInPulse: null,
    };
  }

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
    if (rangePrompt) {
      return {
        customMessage: rangePrompt,
        pending: false,
        countInPulse: null,
      };
    }
    if (selectedInputCapability && selectedInputCapability.status !== 'READY') {
      if (selectedInputCapability.status === 'MODEL_URL_NOT_CONFIGURED') {
        return {
          messageKey: 'micModelNotConfigured',
          isError: true,
          pending: false,
          countInPulse: null,
        };
      }
      if (selectedInputCapability.status === 'BROWSER_UNSUPPORTED') {
        return {
          messageKey: inputSource === 'MIDI' ? 'midiBrowserUnsupported' : 'micBrowserUnsupported',
          isError: true,
          pending: false,
          countInPulse: null,
        };
      }
      if (selectedInputCapability.status === 'NO_CONNECTED_INPUT') {
        return {
          messageKey: 'midiNoConnectedInput',
          isError: true,
          pending: false,
          countInPulse: null,
        };
      }
    }
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
  inputError = null,
  inputSource = 'MICROPHONE',
  selectedInputCapability,
  rangePrompt = null,
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
        inputError,
        inputSource,
        selectedInputCapability,
        rangePrompt,
        sessionMode,
        performanceClock,
      }),
    [
      inputError,
      inputSource,
      inputState,
      lifecycle,
      performanceClock,
      rangePrompt,
      selectedInputCapability,
      sessionMode,
    ]
  );

  const isRecording = lifecycle === 'ACTIVE' || lifecycle === 'PAUSED';

  let messageText = '';
  if (resolvedView.countInPulse !== null) {
    messageText = t('performanceCountIn', { pulse: resolvedView.countInPulse });
  } else if (resolvedView.isError) {
    if (
      resolvedView.messageKey === 'midiNoConnectedInput' ||
      resolvedView.messageKey === 'micModelNotConfigured' ||
      resolvedView.messageKey === 'micBrowserUnsupported' ||
      resolvedView.messageKey === 'midiBrowserUnsupported'
    ) {
      messageText = t(resolvedView.messageKey);
    } else {
      const baseError = resolvedView.messageKey ? t(resolvedView.messageKey) : '';
      messageText = resolvedView.customMessage
        ? `${baseError}: ${resolvedView.customMessage}`
        : baseError;
    }
  } else if (resolvedView.customMessage) {
    messageText = resolvedView.customMessage;
  } else if (resolvedView.messageKey) {
    messageText = t(resolvedView.messageKey);
  }

  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-h-11 items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm',
        resolvedView.isError ? 'border-rose-300 bg-rose-50/70 text-rose-900' : '',
        className
      )}
    >
      {resolvedView.pending ? (
        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-orange-500" aria-hidden="true" />
      ) : resolvedView.isError ? (
        <AlertCircle className="h-4 w-4 shrink-0 text-rose-600" aria-hidden="true" />
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
      <span
        className={cn(
          'min-w-0 max-w-xs truncate font-medium sm:max-w-md',
          resolvedView.isError ? 'text-rose-800' : 'text-slate-700'
        )}
      >
        {messageText}
      </span>
      {isRecording ? (
        <span className="flex shrink-0 items-center gap-1.5 border-l border-slate-200 pl-2.5 font-semibold tabular-nums text-rose-600">
          <Mic className="h-3.5 w-3.5" aria-hidden="true" />
          {formatTime(practiceTime)}
        </span>
      ) : null}
    </div>
  );
}
