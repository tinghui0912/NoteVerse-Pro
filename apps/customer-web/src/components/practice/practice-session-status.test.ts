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
    countInBeats: 4,
    countInPulses: 4,
    scopeCompleted: false,
    scopeStartBeat: 1,
    scopeTerminalBeat: 4,
    speedRatio: 1,
    completionReason: null,
    ...overrides,
  };
}

describe('resolvePracticeSessionStatusView', () => {
  it('shows preparingPractice during connecting status', () => {
    expect(
      resolvePracticeSessionStatusView({
        status: 'connecting',
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'preparingPractice',
      pending: true,
    });
  });

  it('shows finishingPractice during finishing status', () => {
    expect(
      resolvePracticeSessionStatusView({
        status: 'finishing',
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'finishingPractice',
      pending: true,
    });
  });

  it('shows paused during paused status', () => {
    expect(
      resolvePracticeSessionStatusView({
        status: 'paused',
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'settingStatusPaused',
      pending: false,
    });
  });

  it('shows waitingForFirstNote during STEP listening status', () => {
    expect(
      resolvePracticeSessionStatusView({
        status: 'listening',
        sessionMode: 'STEP_BY_STEP',
      })
    ).toMatchObject({
      messageKey: 'waitingForFirstNote',
      pending: false,
    });
  });

  it('shows performanceCountIn during CONTINUOUS count-in', () => {
    expect(
      resolvePracticeSessionStatusView({
        status: 'practicing',
        sessionMode: 'CONTINUOUS_PLAY',
        performanceClock: makePerformanceClock({
          state: 'COUNT_IN',
          countInRemainingMs: 1000,
          countInPulses: 3,
        }),
      })
    ).toMatchObject({
      messageKey: 'performanceCountIn',
      pending: false,
    });
  });

  it('shows performanceRunning during CONTINUOUS playing', () => {
    expect(
      resolvePracticeSessionStatusView({
        status: 'practicing',
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
          status: 'listening',
          sessionMode: 'STEP_BY_STEP',
          practiceTime: 65, // 01:05
        })
      )
    );

    expect(screen.getByText('Ready. Play the current note.')).toBeTruthy();
    expect(screen.getByText('01:05')).toBeTruthy();
  });
});
