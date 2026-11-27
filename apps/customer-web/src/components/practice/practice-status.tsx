'use client';
import type { PracticeResourceImpact } from '@/lib/practice/continuous/resource-intervention';

import { AlertCircle, LoaderCircle } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useMemo, type ReactNode } from 'react';
import type { PracticeDeviceIssue } from '@/lib/practice/device/device-contract';
import { practiceDeviceIssueMessageKeys } from './practice-device-status';

import { cn } from '@/lib/utils';
import type { PracticeMode } from '@/lib/practice/planning/intent';
import type { PracticeInputSource } from '@/lib/practice/planning/intent';
import type { PerformanceClockSnapshot } from '@/lib/practice/continuous/domain/performance-clock';
import type { PracticeExecutionLifecycle, PracticeExecutionErrorCode } from '@/lib/practice/application/execution-view';
import type { LocalPracticeInputState } from '@/lib/practice/input-state';
import type { StepAttemptState, StepAttemptRecord } from '@/lib/practice/step/domain/attempt';
import type { PracticeMicrophoneCapability, PracticeMidiCapability } from '@/lib/practice/input-capability';
import { continuousErrorMessageKeys, type ContinuousErrorCode } from '@/lib/practice/continuous/continuous-errors';
import { STEP_ERROR_MESSAGES, type StepApplicationErrorCode } from '@/lib/practice/step/step-errors';

type PracticeStatusMessageKey =
  | typeof continuousErrorMessageKeys[ContinuousErrorCode]
  | 'recordingPaused'
  | 'inputPaused'
  | 'performanceCountIn'
  | 'performanceStarting'
  | 'finishingPractice'
  | 'waitingForFirstNote'
  | 'stepCapturing'
  | 'stepAnalyzing'
  | 'stepPostVerdictMatch'
  | 'stepPostVerdictMismatch'
  | 'stepMicrophoneReady'
  | 'stepMicrophoneChecking'
  | 'stepInputInterrupted'
  | 'stepInfrastructureUnavailable'
  | 'settingStatusFollowing'
  | 'settingStatusPaused'
  | 'micStartFailed'
  | 'midiStartFailed'
  | 'micBrowserUnsupported'
  | 'midiBrowserUnsupported'
  | 'midiNoConnectedInput';

export type PracticeStatusView = {
  messageKey?: PracticeStatusMessageKey;
  customMessage?: string;
  isError?: boolean;
  pending: boolean;
  countInPulse: number | null;
};

export type PracticeStatusProps = {
  className?: string;
  deviceIssue?: PracticeDeviceIssue | null;
  deviceControls?: ReactNode;
  lifecycle: PracticeExecutionLifecycle;
  stepInteractionPhase?: StepAttemptState | null;
  pendingPostVerdict?: StepAttemptRecord | null;
  inputState?: LocalPracticeInputState;
  inputError?: PracticeExecutionErrorCode | null;
  resourceImpact?: PracticeResourceImpact | null;
  inputSource?: PracticeInputSource;
  selectedInputCapability?: PracticeMicrophoneCapability | PracticeMidiCapability;
  rangePrompt?: string | null;
  sessionMode: PracticeMode;
  performanceClock?: PerformanceClockSnapshot | null;
};

export function resolvePracticeStatusView({
  lifecycle,
  inputState = 'IDLE',
  inputError = null,
  resourceImpact = null,
  inputSource = 'MICROPHONE',
  selectedInputCapability,
  rangePrompt = null,
  sessionMode,
  performanceClock,
  stepInteractionPhase,
  pendingPostVerdict,
}: {
  lifecycle: PracticeExecutionLifecycle;
  stepInteractionPhase?: StepAttemptState | null;
  pendingPostVerdict?: StepAttemptRecord | null;
  inputState?: LocalPracticeInputState;
  inputError?: PracticeExecutionErrorCode | null;
  resourceImpact?: PracticeResourceImpact | null;
  inputSource?: PracticeInputSource;
  selectedInputCapability?: PracticeMicrophoneCapability | PracticeMidiCapability;
  rangePrompt?: string | null;
  sessionMode: PracticeMode;
  performanceClock?: PerformanceClockSnapshot | null;
}): PracticeStatusView {
  if (inputState === 'ERROR') {
    if (sessionMode === 'STEP_BY_STEP' && inputError === 'STEP_MICROPHONE_INTERRUPTED') {
      return { messageKey: 'stepInputInterrupted', pending: false, countInPulse: null };
    }
    if (sessionMode === 'STEP_BY_STEP' && inputError === 'STEP_MICROPHONE_INFRASTRUCTURE_FAILED') {
      return { messageKey: 'stepInfrastructureUnavailable', isError: true, pending: false, countInPulse: null };
    }
    if (inputError && Object.hasOwn(continuousErrorMessageKeys, inputError)) {
      return { messageKey: continuousErrorMessageKeys[inputError as ContinuousErrorCode],
        isError: true, pending: false, countInPulse: null };
    }
    if (inputError === 'NO_CONNECTED_INPUT') {
      return {
        messageKey: 'midiNoConnectedInput',
        isError: true,
        pending: false,
        countInPulse: null,
      };
    }
    if (sessionMode === 'STEP_BY_STEP' && inputError && Object.hasOwn(STEP_ERROR_MESSAGES, inputError)) {
      return { customMessage: STEP_ERROR_MESSAGES[inputError as StepApplicationErrorCode], isError: true, pending: false, countInPulse: null };
    }
    return {
      messageKey: inputSource === 'MIDI' ? 'midiStartFailed' : 'micStartFailed',
      isError: true,
      pending: false,
      countInPulse: null,
    };
  }

  if (inputState === 'STARTING') return { pending: false, countInPulse: null };
  if (resourceImpact) return { messageKey: resourceImpact === 'RECORDING_ONLY' ? 'recordingPaused' : 'inputPaused', pending: false, countInPulse: null };

  if (sessionMode === 'CONTINUOUS_PLAY' && lifecycle === 'PAUSED') {
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
    if (selectedInputCapability && !selectedInputCapability.supported) {
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
      pending: false,
      countInPulse: null,
    };
  }

  if (stepInteractionPhase === 'CAPTURING' || stepInteractionPhase === 'ANALYZING') {
    return { messageKey: inputSource === 'MICROPHONE' ? 'stepMicrophoneChecking' : stepInteractionPhase === 'CAPTURING' ? 'stepCapturing' : 'stepAnalyzing', pending: true, countInPulse: null };
  }
  if (stepInteractionPhase === 'POST_VERDICT' && pendingPostVerdict) {
    const messageKey = pendingPostVerdict.verdict === 'MATCH' ? 'stepPostVerdictMatch' : 'stepPostVerdictMismatch';
    return { messageKey, pending: false, countInPulse: null };
  }
  return {
    messageKey: inputSource === 'MICROPHONE' ? 'stepMicrophoneReady' : 'waitingForFirstNote',
    pending: false,
    countInPulse: null,
  };
}

export function PracticeStatus({
  className,
  deviceIssue = null,
  deviceControls,
  lifecycle,
  inputState = 'IDLE',
  inputError = null,
  resourceImpact = null,
  inputSource = 'MICROPHONE',
  selectedInputCapability,
  rangePrompt = null,
  sessionMode,
  performanceClock,
  stepInteractionPhase,
  pendingPostVerdict,
}: PracticeStatusProps) {
  const t = useTranslations('practice');
  const resolvedView = useMemo(
    () =>
      resolvePracticeStatusView({
        lifecycle,
        inputState,
        inputError,
        resourceImpact,
        inputSource,
        selectedInputCapability,
        rangePrompt,
        sessionMode,
        performanceClock,
        stepInteractionPhase,
        pendingPostVerdict,
      }),
    [
      inputError,
      resourceImpact,
      inputSource,
      inputState,
      lifecycle,
      performanceClock,
      rangePrompt,
      selectedInputCapability,
      sessionMode,
      stepInteractionPhase,
      pendingPostVerdict,
    ]
  );


  let messageText = '';
  if (resolvedView.countInPulse !== null) {
    messageText = t('performanceCountIn', { pulse: resolvedView.countInPulse });
  } else if (resolvedView.isError) {
    if (
      resolvedView.messageKey === 'midiNoConnectedInput' ||
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

  if (deviceIssue) messageText = t(practiceDeviceIssueMessageKeys[deviceIssue.condition], { resource: t(`deviceResource_${deviceIssue.resource}`) });
  const isError = !deviceIssue && resolvedView.isError;
  const pending = !deviceIssue && resolvedView.pending;
  if (!messageText && !deviceControls) return null;
  return (
    <div
      data-testid="practice-status"
      role="status"
      aria-live="polite"
      className={cn(
        'flex min-h-11 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm',
        isError ? 'border-rose-300 bg-rose-50/70 text-rose-900' : '',
        className
      )}
    >
      {messageText && <div className="flex min-w-0 items-center gap-2">
      {pending ? (
        <LoaderCircle className="h-4 w-4 shrink-0 animate-spin text-orange-500" aria-hidden="true" />
      ) : isError ? (
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
          'min-w-0 font-medium',
          !deviceIssue && sessionMode === 'STEP_BY_STEP' && inputSource === 'MICROPHONE'
            ? 'whitespace-normal' : 'max-w-xs truncate sm:max-w-md',
          isError ? 'text-rose-800' : 'text-slate-700'
        )}
      >
        {messageText}
      </span>
      </div>}
      {deviceControls && <div className="ml-auto flex shrink-0 items-center gap-1">{deviceControls}</div>}
    </div>
  );
}
