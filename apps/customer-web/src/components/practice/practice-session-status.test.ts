// @vitest-environment jsdom

import { act, cleanup, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  PracticeSessionStatus,
  resolvePracticeSessionStatusView,
} from './practice-session-status';
import type {
  PracticeAlignmentUpdateMessage,
  PracticePerformanceClockPayload,
} from '@/lib/practice/protocol';
import practiceMessages from '../../../messages/en/practice.json';

type AlignmentPayload = PracticeAlignmentUpdateMessage['payload'];

const baseProps = {
  status: 'practicing' as const,
  connectionStatus: 'ready' as const,
  isLoading: false,
  isPreparingSession: false,
  canPrepareSession: true,
  audioWorkletSupported: true,
  sessionMode: 'STEP_BY_STEP' as const,
  practiceClockStarted: true,
  practiceTime: 12,
};

const IntlProvider = NextIntlClientProvider as ComponentType<{
  locale: string;
  messages: { practice: typeof practiceMessages };
  children?: ReactNode;
}>;

function makeAlignment(
  overrides: Partial<AlignmentPayload> = {}
): AlignmentPayload {
  const action = overrides.decision?.action ?? 'advance';
  return {
    beat_position: 3,
    confidence: 0.95,
    alignment_confidence: 0.95,
    audio_confidence: 0.95,
    continuity_confidence: 0.95,
    visual_confidence: 0.95,
    timestamp_ms: 20,
    scope_completed: false,
      completion_reason: null,
    audio_active: true,
    input_rms: 0.04,
    input_peak: 0.1,
    input_health: {
      available: true,
      level: 'good',
      noise: 'good',
      confidence: 1,
    },
    match_state: 'matched',
    feature_confidence: 0.95,
    beat_delta: null,
    stream_state: 'following',
    frame_class: 'tonal',
    gate_reason: 'start_confirmed',
    queue_decision: 'queued_tonal',
    tonal_signal: true,
    onset_signal: false,
    spectral_flatness: 0.02,
    peak_prominence: 20,
    spectral_flux: 0.1,
    alignment_state: 'matched',
    continuity_state: 'stable',
    beat_velocity: null,
    validation_confidence: 0.95,
    input_weight: 1,
    input_policy_confidence: 1,
    decision: {
      action,
      reason: 'stable_match',
      experience_state: 'following',
      display_anchor: { beat: 3, render_note_ids: ['n1'] },
      confidence_summary: {
        visual: 0.95,
        alignment: 0.95,
        audio: 0.95,
        continuity: 0.95,
        validation: 0.95,
        input_policy: 1,
      },
    },
    ...overrides,
  };
}

function statusElement(alignment: AlignmentPayload) {
  return createElement(
    IntlProvider,
    {
      locale: 'en',
      messages: { practice: practiceMessages },
    },
    createElement(PracticeSessionStatus, {
      ...baseProps,
      alignment,
    })
  );
}

function renderStatus(alignment: AlignmentPayload) {
  return render(statusElement(alignment));
}

function makePossibleWrongNoteAlignment() {
  return makeAlignment({
    decision: {
      action: 'hold',
      reason: 'low_alignment_confidence',
      experience_state: 'possible_wrong_note',
      display_anchor: { beat: 3, render_note_ids: ['n1'] },
      confidence_summary: {
        visual: 0.2,
        alignment: 0.2,
        audio: 0.8,
        continuity: 1,
        validation: 0.2,
        input_policy: 1,
      },
    },
  });
}

function makePerformanceClockSync(
  overrides: Partial<PracticePerformanceClockPayload> = {}
): PracticePerformanceClockPayload {
  return {
    state: 'RUNNING',
    musical_beat: 1,
    performance_time_ms: 0,
    count_in_remaining_ms: 0,
    count_in_remaining_pulses: 0,
    scope_completed: false,
    scope_start_group_id: null,
    scope_end_group_id: null,
    scope_start_beat: 1,
    scope_terminal_beat: 4,
    nominal_scope_duration_ms: 3000,
    speed_ratio: 1,
    ...overrides,
  };
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('resolvePracticeSessionStatusView', () => {
  it('shows following when the backend decision is following', () => {
    expect(
      resolvePracticeSessionStatusView({
        ...baseProps,
        alignment: makeAlignment(),
      })
    ).toMatchObject({
      messageKey: 'settingStatusFollowing',
      uncertain: false,
    });
  });

  it('shows a calm uncertainty state for possible wrong notes', () => {
    expect(
      resolvePracticeSessionStatusView({
        ...baseProps,
        alignment: makePossibleWrongNoteAlignment(),
      })
    ).toMatchObject({
      messageKey: 'practiceStateWaitingCorrectNote',
      uncertain: true,
    });
  });

  it('shows partial-match guidance without marking it as uncertain', () => {
    expect(
      resolvePracticeSessionStatusView({
        ...baseProps,
        alignment: makeAlignment({
          decision: {
            action: 'wait',
            reason: 'partial_match',
            experience_state: 'partially_matched',
            display_anchor: { beat: 3, render_note_ids: ['n1'] },
            confidence_summary: {
              visual: 0.9,
              alignment: 0.9,
              audio: 0.9,
              continuity: 1,
              validation: 0.9,
              input_policy: 1,
            },
          },
        }),
      })
    ).toMatchObject({
      messageKey: 'practiceStatePartiallyMatched',
      uncertain: false,
    });
  });

  it('keeps input health separate from the practice state', () => {
    expect(
      resolvePracticeSessionStatusView({
        ...baseProps,
        alignment: makeAlignment({
          input_health: {
            available: true,
            level: 'too_quiet',
            noise: 'good',
            confidence: 1,
          },
          decision: {
            action: 'wait',
            reason: 'insufficient_input',
            experience_state: 'waiting_for_input',
            display_anchor: null,
            confidence_summary: {
              visual: 0,
              alignment: 0,
              audio: 0,
              continuity: 1,
              validation: 0,
              input_policy: 0,
            },
          },
        }),
      })
    ).toMatchObject({
      messageKey: 'waitingForFirstNote',
      inputHintKey: 'practiceInputCheckMic',
      uncertain: false,
    });
  });

  it('shows runtime noise health without changing the practice state', () => {
    expect(
      resolvePracticeSessionStatusView({
        ...baseProps,
        alignment: makeAlignment({
          input_health: {
            available: true,
            level: 'good',
            noise: 'high',
            confidence: 1,
          },
        }),
      })
    ).toMatchObject({
      messageKey: 'settingStatusFollowing',
      inputHintKey: 'practiceInputNoiseHigh',
      uncertain: false,
    });
  });

  it('shows fixed-clock performance progress without requiring alignment evidence', () => {
    expect(
      resolvePracticeSessionStatusView({
        ...baseProps,
        sessionMode: 'CONTINUOUS_PLAY',
        alignment: null,
      })
    ).toMatchObject({
      messageKey: 'performanceRunning',
      inputHintKey: null,
      uncertain: false,
    });
  });

  it('shows fixed-clock count-in without step-by-step first-note guidance', () => {
    expect(
      resolvePracticeSessionStatusView({
        ...baseProps,
        status: 'listening',
        sessionMode: 'CONTINUOUS_PLAY',
        alignment: null,
        performanceClockSync: makePerformanceClockSync({
          state: 'COUNT_IN',
          count_in_remaining_ms: 1000,
          count_in_remaining_pulses: 2,
        }),
      })
    ).toMatchObject({
      messageKey: 'performanceCountIn',
      uncertain: false,
    });
  });

  it('renders visible fixed-clock count-in pulses', () => {
    const status = createElement(PracticeSessionStatus, {
      ...baseProps,
      status: 'listening',
      sessionMode: 'CONTINUOUS_PLAY',
      alignment: null,
      performanceClockSync: makePerformanceClockSync({
        state: 'COUNT_IN',
        count_in_remaining_ms: 1800,
        count_in_remaining_pulses: 4,
      }),
      performanceClockSyncReceivedAtMs: 0,
    });
    const { rerender } = render(
      createElement(
        IntlProvider,
        {
          locale: 'en',
          messages: { practice: practiceMessages },
        },
        status
      )
    );

    expect(screen.getByText('Count-in 4')).toBeTruthy();

    rerender(
      createElement(
        IntlProvider,
        {
          locale: 'en',
          messages: { practice: practiceMessages },
        },
        createElement(PracticeSessionStatus, {
          ...baseProps,
          status: 'listening',
          sessionMode: 'CONTINUOUS_PLAY',
          alignment: null,
          performanceClockSync: makePerformanceClockSync({
            state: 'COUNT_IN',
            count_in_remaining_ms: 1800,
            count_in_remaining_pulses: 4,
          }),
          performanceClockSyncReceivedAtMs: -450,
        })
      )
    );

    expect(screen.getByText('Count-in 3')).toBeTruthy();

    rerender(
      createElement(
        IntlProvider,
        {
          locale: 'en',
          messages: { practice: practiceMessages },
        },
        createElement(PracticeSessionStatus, {
          ...baseProps,
          status: 'listening',
          sessionMode: 'CONTINUOUS_PLAY',
          alignment: null,
          performanceClockSync: makePerformanceClockSync({
            state: 'COUNT_IN',
            count_in_remaining_ms: 1800,
            count_in_remaining_pulses: 4,
          }),
          performanceClockSyncReceivedAtMs: -1800,
        })
      )
    );

    expect(screen.getByText('Starting')).toBeTruthy();
  });

  it('does not show a pending connection state after an idle setup failure', () => {
    expect(
      resolvePracticeSessionStatusView({
        status: 'idle',
        connectionStatus: 'error',
        isLoading: false,
        isPreparingSession: false,
        canPrepareSession: true,
        audioWorkletSupported: true,
        sessionMode: 'STEP_BY_STEP',
        alignment: null,
      })
    ).toMatchObject({
      messageKey: 'settingStatusReady',
      pending: false,
    });
  });

  it('shows a distinct pending state while completion is being finalized', () => {
    expect(
      resolvePracticeSessionStatusView({
        ...baseProps,
        status: 'finishing',
        alignment: null,
      })
    ).toMatchObject({
      messageKey: 'finishingPractice',
      pending: true,
    });
  });
});

describe('PracticeSessionStatus', () => {
  it('keeps following visible for transient uncertainty', () => {
    vi.useFakeTimers();
    const { rerender } = renderStatus(makeAlignment());

    expect(screen.getByText('Following in real time')).toBeTruthy();

    rerender(statusElement(makePossibleWrongNoteAlignment()));

    act(() => {
      vi.advanceTimersByTime(250);
    });
    expect(screen.getByText('Following in real time')).toBeTruthy();

    rerender(statusElement(makeAlignment()));
    act(() => {
      vi.runOnlyPendingTimers();
    });

    expect(screen.getByText('Following in real time')).toBeTruthy();
  });

  it('shows uncertainty after the delay and recovers immediately on reliable following', () => {
    vi.useFakeTimers();
    const { rerender } = renderStatus(makeAlignment());

    rerender(statusElement(makePossibleWrongNoteAlignment()));
    act(() => {
      vi.advanceTimersByTime(350);
    });

    expect(screen.getByText('Waiting for the correct note')).toBeTruthy();

    rerender(statusElement(makeAlignment()));

    expect(screen.getByText('Following in real time')).toBeTruthy();
  });
});
