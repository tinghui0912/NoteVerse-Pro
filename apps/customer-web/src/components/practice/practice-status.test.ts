// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  PracticeStatus,
  resolvePracticeStatusView,
} from './practice-status';
import type { PerformanceClockSnapshot } from '@/lib/practice/continuous/domain/performance-clock';
import practiceMessages from '../../../messages/en/practice.json';
import type { StepAttemptRecord } from '@/lib/practice/step/domain/attempt';

it.each(['READY', 'CAPTURING', 'ANALYZING', 'POST_VERDICT'] as const)('STEP status presents runtime phase %s, not session ACTIVE as READY', phase => {
  const view = resolvePracticeStatusView({ lifecycle: 'ACTIVE', sessionMode: 'STEP_BY_STEP', stepInteractionPhase: phase,
    lastFinalizedVerdict: { verdict: 'MISMATCH' } as StepAttemptRecord });
  const keys = { READY: 'waitingForFirstNote', CAPTURING: 'stepCapturing', ANALYZING: 'stepAnalyzing', POST_VERDICT: 'stepPostVerdictMismatch' };
  expect(view.messageKey).toBe(keys[phase]);
  expect(view.pending).toBe(phase === 'CAPTURING' || phase === 'ANALYZING');
});

const IntlProvider = NextIntlClientProvider as ComponentType<{
  locale: string;
  messages: { practice: typeof practiceMessages };
  children?: ReactNode;
}>;

function makePerformanceClock(
  overrides: Partial<PerformanceClockSnapshot> = {}
): PerformanceClockSnapshot {
  return {
    state: 'RUNNING',
    nowMs: 1000,
    musicalBeat: 1,
    performanceTimeMs: 0,
    countInRemainingMs: 0,
    countInTotalMs: 2000,
    countInBeats: 4,
    countInPulses: 4,
    countInPulse: 1,
    scopeCompleted: false,
    scopeStartBeat: 1,
    scopeTerminalBeat: 4,
    completionReason: null,
    ...overrides,
  };
}

describe('resolvePracticeStatusView', () => {
  it('shows preparingPractice during STARTING inputState', () => {
    expect(
      resolvePracticeStatusView({
        lifecycle: 'READY',
        inputState: 'STARTING',
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'preparingPractice',
      pending: true,
    });
  });

  it('shows paused during PAUSED lifecycle', () => {
    expect(
      resolvePracticeStatusView({
        lifecycle: 'PAUSED',
        sessionMode: 'CONTINUOUS_PLAY',
      })
    ).toMatchObject({
      messageKey: 'settingStatusPaused',
      pending: false,
    });
  });

  it('shows waitingForFirstNote during ACTIVE STEP mode', () => {
    expect(
      resolvePracticeStatusView({
        lifecycle: 'ACTIVE',
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'waitingForFirstNote',
      pending: false,
    });
  });

  it('shows performanceCountIn with countInPulse during CONTINUOUS count-in', () => {
    expect(
      resolvePracticeStatusView({
        lifecycle: 'ACTIVE',
        sessionMode: 'CONTINUOUS_PLAY',
        performanceClock: makePerformanceClock({
          state: 'COUNT_IN',
          countInRemainingMs: 1000,
          countInPulses: 4,
          countInPulse: 3,
        }),
      })
    ).toMatchObject({
      messageKey: 'performanceCountIn',
      pending: false,
      countInPulse: 3,
    });
  });

  it('shows performanceRunning during CONTINUOUS playing', () => {
    expect(
      resolvePracticeStatusView({
        lifecycle: 'ACTIVE',
        sessionMode: 'CONTINUOUS_PLAY',
        performanceClock: makePerformanceClock({
          state: 'RUNNING',
        }),
      })
    ).toMatchObject({
      messageKey: 'performanceRunning',
      pending: false,
    });
  });

  it('shows error state when inputState is ERROR', () => {
    expect(
      resolvePracticeStatusView({
        lifecycle: 'READY',
        inputState: 'ERROR',
        inputError: 'Model asset not configured',
        inputSource: 'MICROPHONE',
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'micStartFailed',
      customMessage: 'Model asset not configured',
      isError: true,
      pending: false,
    });

    expect(
      resolvePracticeStatusView({
        lifecycle: 'READY',
        inputState: 'ERROR',
        inputError: 'MIDI access denied',
        inputSource: 'MIDI',
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'midiStartFailed',
      customMessage: 'MIDI access denied',
      isError: true,
      pending: false,
    });
  });

  it('maps NO_CONNECTED_INPUT error directly to midiNoConnectedInput', () => {
    expect(
      resolvePracticeStatusView({
        lifecycle: 'READY',
        inputState: 'ERROR',
        inputError: 'NO_CONNECTED_INPUT',
        inputSource: 'MIDI',
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'midiNoConnectedInput',
      isError: true,
      pending: false,
    });
  });

  it.each([
    ['STEP_MICROPHONE_PERMISSION_DENIED', 'Microphone permission was denied.'],
    ['STEP_ACOUSTIC_RUNTIME_FAILED', 'Microphone analysis failed. Start a new session.'],
  ])('preserves the STEP application error %s', (inputError, customMessage) => {
    expect(resolvePracticeStatusView({ lifecycle: 'ENDED', inputState: 'ERROR', inputError,
      inputSource: 'MICROPHONE', sessionMode: 'STEP_BY_STEP' })).toMatchObject({
      customMessage, isError: true, pending: false,
    });
  });

  it.each([
    ['MICROPHONE_PERMISSION_DENIED', 'micPermissionDenied'],
    ['ANALYSIS_FAILED', 'micAnalysisFailed'],
  ])('preserves the Continuous application error %s', (inputError, messageKey) => {
    expect(resolvePracticeStatusView({ lifecycle: 'ACTIVE', inputState: 'ERROR', inputError,
      inputSource: 'MICROPHONE', sessionMode: 'CONTINUOUS_PLAY' })).toMatchObject({
      messageKey, isError: true, pending: false,
    });
  });

  it('displays capability unavailability reasons before practice starts', () => {
    // Mic browser unsupported
    expect(
      resolvePracticeStatusView({
        lifecycle: 'READY',
        inputState: 'IDLE',
        inputSource: 'MICROPHONE',
        selectedInputCapability: {
          supported: false,
          status: 'BROWSER_UNSUPPORTED',
          reason: 'BROWSER_UNSUPPORTED',
        },
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'micBrowserUnsupported',
      isError: true,
    });

    // MIDI browser unsupported
    expect(
      resolvePracticeStatusView({
        lifecycle: 'READY',
        inputState: 'IDLE',
        inputSource: 'MIDI',
        selectedInputCapability: {
          supported: false,
          status: 'BROWSER_UNSUPPORTED',
          reason: 'BROWSER_UNSUPPORTED',
        },
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'midiBrowserUnsupported',
      isError: true,
    });

    // MIDI no connected input
    expect(
      resolvePracticeStatusView({
        lifecycle: 'READY',
        inputState: 'IDLE',
        inputSource: 'MIDI',
        selectedInputCapability: {
          supported: false,
          status: 'NO_CONNECTED_INPUT',
          reason: 'NO_CONNECTED_INPUT',
        },
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'midiNoConnectedInput',
      isError: true,
    });
  });
});

describe('PracticeStatus rendering', () => {
  it('renders status text and recording time', () => {
    render(
      createElement(
        IntlProvider,
        {
          locale: 'en',
          messages: { practice: practiceMessages },
        },
        createElement(PracticeStatus, {
          lifecycle: 'ACTIVE',
          sessionMode: 'STEP_BY_STEP',
          practiceTime: 65, // 01:05
        })
      )
    );

    expect(screen.getByText('Ready. Play the current note.')).toBeTruthy();
    expect(screen.getByText('01:05')).toBeTruthy();
  });

  it('renders visible error message on inputState ERROR', () => {
    render(
      createElement(
        IntlProvider,
        {
          locale: 'en',
          messages: { practice: practiceMessages },
        },
        createElement(PracticeStatus, {
          lifecycle: 'READY',
          inputState: 'ERROR',
          inputError: 'Device disconnected',
          inputSource: 'MICROPHONE',
          sessionMode: 'STEP_BY_STEP',
          practiceTime: 0,
        })
      )
    );

    expect(screen.getByText(/Failed to start microphone: Device disconnected/)).toBeTruthy();
  });

  it('renders the browser prerequisite error before Continuous starts', () => {
    render(
      createElement(
        IntlProvider,
        {
          locale: 'en',
          messages: { practice: practiceMessages },
        },
        createElement(PracticeStatus, {
          lifecycle: 'READY',
          inputState: 'IDLE',
          inputSource: 'MICROPHONE',
          selectedInputCapability: {
            supported: false,
            status: 'BROWSER_UNSUPPORTED',
            reason: 'BROWSER_UNSUPPORTED',
          },
          sessionMode: 'CONTINUOUS_PLAY',
          practiceTime: 0,
        })
      )
    );

    expect(
      screen.getByText('The current browser does not support the required microphone practice features')
    ).toBeTruthy();
  });

  it('renders no connected input message on NO_CONNECTED_INPUT error', () => {
    render(
      createElement(
        IntlProvider,
        {
          locale: 'en',
          messages: { practice: practiceMessages },
        },
        createElement(PracticeStatus, {
          lifecycle: 'READY',
          inputState: 'ERROR',
          inputError: 'NO_CONNECTED_INPUT',
          inputSource: 'MIDI',
          sessionMode: 'STEP_BY_STEP',
          practiceTime: 0,
        })
      )
    );

    expect(
      screen.getByText('No MIDI input devices detected. Please connect a MIDI keyboard and retry.')
    ).toBeTruthy();
  });
});


