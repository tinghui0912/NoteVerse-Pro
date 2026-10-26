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
import zhPracticeMessages from '../../../messages/zh/practice.json';
import type { StepAttemptRecord } from '@/lib/practice/step/domain/attempt';

function stepRecord(verdict: 'MATCH' | 'MISMATCH'): StepAttemptRecord {
  const evidence = { attemptId: 'attempt', localSessionId: 'step', stepId: 'target', targetGeneration: 1,
    inputSource: 'MICROPHONE' as const, attemptStartSessionTime: { domainId: 'step', ms: 100 },
    observedAttackPitches: ['C4','E4','G4'] as const, confidence: .8, captureEndSessionTime: { domainId: 'step', ms: 150 } };
  return { ...evidence, verdict };
}

it.each(['READY', 'CAPTURING', 'ANALYZING', 'POST_VERDICT'] as const)('STEP status presents runtime phase %s, not session ACTIVE as READY', phase => {
  const view = resolvePracticeStatusView({ lifecycle: 'ACTIVE', sessionMode: 'STEP_BY_STEP', stepInteractionPhase: phase,
    pendingPostVerdict: stepRecord('MISMATCH') });
  const keys = { READY: 'stepMicrophoneReady', CAPTURING: 'stepMicrophoneChecking', ANALYZING: 'stepMicrophoneChecking', POST_VERDICT: 'stepPostVerdictMismatch' };
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
  it('keeps binding silent in the global status surface', () => {
    expect(
      resolvePracticeStatusView({
        lifecycle: 'READY',
        inputState: 'STARTING',
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      pending: false, countInPulse: null,
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

  it('shows paced microphone instructions during ACTIVE STEP mode', () => {
    expect(
      resolvePracticeStatusView({
        lifecycle: 'ACTIVE',
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'stepMicrophoneReady',
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

  it('does not narrate normal Continuous running', () => {
    expect(
      resolvePracticeStatusView({
        lifecycle: 'ACTIVE',
        sessionMode: 'CONTINUOUS_PLAY',
        performanceClock: makePerformanceClock({
          state: 'RUNNING',
        }),
      })
    ).toMatchObject({
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
  it('renders paced STEP instruction without a transport timer', () => {
    render(
      createElement(
        IntlProvider,
        {
          locale: 'en',
          messages: { practice: practiceMessages },
        },
        createElement(PracticeStatus, {
          lifecycle: 'ACTIVE',
          sessionMode: 'STEP_BY_STEP', // 01:05
        })
      )
    );

    expect(screen.getByText('Play the highlighted note. Wait for the result before playing again.')).toBeTruthy();
    expect(screen.queryByText('01:05')).toBeNull();
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
        })
      )
    );

    expect(
      screen.getByText('No MIDI input devices detected. Please connect a MIDI keyboard and retry.')
    ).toBeTruthy();
  });
});




describe('paced STEP learning feedback', () => {
  it.each([
    { locale: 'en', messages: practiceMessages, ready: 'Play the highlighted note. Wait for the result before playing again.', busy: 'Checking your answer. Wait before playing again.', mismatch: 'Not matched yet. Try again.' },
    { locale: 'zh', messages: zhPracticeMessages, ready: '弹奏当前高亮音；识别结果出现前请等待，不要连续弹奏。', busy: '正在识别本次输入，请等待结果后再弹。', mismatch: '尚未匹配，请再试一次。' },
  ])('$locale microphone instructions pace input without claiming physical mistakes', ({ locale, messages, ready, busy, mismatch }) => {
    const status = (phase: 'READY' | 'CAPTURING' | 'ANALYZING' | 'POST_VERDICT') => createElement(IntlProvider,
      { locale, messages: { practice: messages } }, createElement(PracticeStatus, {
        lifecycle: 'ACTIVE', sessionMode: 'STEP_BY_STEP', stepInteractionPhase: phase,
        inputSource: 'MICROPHONE', pendingPostVerdict: phase === 'POST_VERDICT' ? stepRecord('MISMATCH') : null,
      }));
    const view = render(status('READY')); expect(screen.getByRole('status')).toHaveTextContent(ready);
    for (const phase of ['CAPTURING', 'ANALYZING'] as const) {
      view.rerender(status(phase)); expect(screen.getByRole('status')).toHaveTextContent(busy);
    }
    view.rerender(status('POST_VERDICT')); expect(screen.getByRole('status')).toHaveTextContent(mismatch);
  });
  it.each(['READY', 'CAPTURING', 'ANALYZING'] as const)('MIDI %s uses its short input status', phase => {
    const result = resolvePracticeStatusView({ lifecycle: 'ACTIVE', sessionMode: 'STEP_BY_STEP', inputSource: 'MIDI', stepInteractionPhase: phase });
    expect(result.messageKey).toBe({ READY: 'waitingForFirstNote', CAPTURING: 'stepCapturing', ANALYZING: 'stepAnalyzing' }[phase]);
  });
  it('infrastructure failure takes priority over a pending learning outcome', () => {
    const result = resolvePracticeStatusView({ lifecycle: 'ENDED', sessionMode: 'STEP_BY_STEP', inputState: 'ERROR',
      inputError: 'STEP_ACOUSTIC_RUNTIME_FAILED', inputSource: 'MICROPHONE', stepInteractionPhase: 'POST_VERDICT', pendingPostVerdict: stepRecord('MISMATCH') });
    expect(result).toMatchObject({ customMessage: 'Microphone analysis failed. Start a new session.', isError: true });
  });
});

it('recording intervention has dedicated status rather than input or acoustic error semantics', () => {
  const status = resolvePracticeStatusView({ lifecycle: 'PAUSED', sessionMode: 'CONTINUOUS_PLAY', resourceImpact: 'RECORDING_ONLY' });
  expect(status.messageKey).toBe('recordingPaused');
});

for (const lifecycle of ['READY', 'ACTIVE'] as const) it(`Continuous ${lifecycle} has no redundant prose or global readiness banner`, () => {
  render(createElement(IntlProvider, { locale: 'en', messages: { practice: practiceMessages } }, createElement(PracticeStatus, {
    lifecycle, sessionMode: 'CONTINUOUS_PLAY', performanceClock: lifecycle === 'ACTIVE' ? makePerformanceClock() : null,
  })));
  expect(screen.queryByRole('status')).toBeNull();
});
it('attempt binding remains silent even for STEP; busy belongs to Start', () => {
  render(createElement(IntlProvider, { locale: 'en', messages: { practice: practiceMessages } }, createElement(PracticeStatus, {
    lifecycle: 'PREPARING', inputState: 'STARTING', sessionMode: 'STEP_BY_STEP',
  })));
  expect(screen.queryByRole('status')).toBeNull();
});
