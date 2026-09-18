// @vitest-environment jsdom

import { render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import {
  PracticeSessionStatus,
  resolvePracticeSessionStatusView,
} from './practice-session-status';
import type { PerformanceClockSnapshot } from '@/lib/practice/local-core/performance-runtime';
import practiceMessages from '../../../messages/en/practice.json';

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

describe('resolvePracticeSessionStatusView', () => {
  it('shows preparingPractice during STARTING inputState', () => {
    expect(
      resolvePracticeSessionStatusView({
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
      resolvePracticeSessionStatusView({
        lifecycle: 'PAUSED',
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'settingStatusPaused',
      pending: false,
    });
  });

  it('shows waitingForFirstNote during ACTIVE STEP mode', () => {
    expect(
      resolvePracticeSessionStatusView({
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
      resolvePracticeSessionStatusView({
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
      resolvePracticeSessionStatusView({
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
});

describe('PracticeSessionStatus rendering', () => {
  it('renders status text and recording time', () => {
    render(
      createElement(
        IntlProvider,
        {
          locale: 'en',
          messages: { practice: practiceMessages },
        },
        createElement(PracticeSessionStatus, {
          lifecycle: 'ACTIVE',
          sessionMode: 'STEP_BY_STEP',
          practiceTime: 65, // 01:05
        })
      )
    );

    expect(screen.getByText('Ready. Play the current note.')).toBeTruthy();
    expect(screen.getByText('01:05')).toBeTruthy();
  });
});
