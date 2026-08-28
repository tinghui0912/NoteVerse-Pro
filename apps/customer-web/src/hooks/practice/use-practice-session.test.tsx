// @vitest-environment jsdom

import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { usePracticeSession } from './use-practice-session';

const apiMocks = vi.hoisted(() => ({
  createPracticeSession: vi.fn(),
  getPracticeSession: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  practiceApi: {
    createPracticeSession: (...args: unknown[]) =>
      apiMocks.createPracticeSession(...args),
    getPracticeSession: (...args: unknown[]) => apiMocks.getPracticeSession(...args),
  },
}));

describe('usePracticeSession', () => {
  beforeEach(() => {
    apiMocks.createPracticeSession.mockReset();
    apiMocks.getPracticeSession.mockReset();
    apiMocks.createPracticeSession.mockResolvedValue({
      data: {
        session_id: 'session-1',
        ws_url: '/api/v1/practice/sessions/session-1/stream',
      },
    });
    apiMocks.getPracticeSession.mockResolvedValue({
      data: {
        session_id: 'session-1',
        score_id: 'score-1',
        revision_id: 'revision-1',
        access_origin: 'OWNER',
        state: 'CREATED',
        progression_mode: 'WAIT_FOR_NOTE',
        realtime_guidance: 'GUIDED',
        evaluation_profile: 'LEARNING',
        input_source: 'MIDI',
        practice_scope: {
          start_expected_group_id: 'entry-4',
          end_expected_group_id: 'entry-6',
          start_measure_number: '12',
          end_measure_number: '12',
        },
        sample_rate: 16000,
        channels: 1,
        frame_format: 'pcm_s16le',
        started_at: null,
        finished_at: null,
        last_beat_position: null,
        last_confidence: null,
        summary_status: 'NOT_REQUESTED',
      },
    });
  });

  it('creates a selected-section step-by-step practice session', async () => {
    const { result } = renderHook(() =>
      usePracticeSession({
        scoreId: 'score-1',
        revisionId: 'revision-1',
        preset: 'STEP_BY_STEP',
        inputSource: 'MIDI',
        practiceScope: {
          start_expected_group_id: 'entry-4',
          end_expected_group_id: 'entry-6',
          start_measure_number: '12',
          end_measure_number: '12',
        },
      })
    );

    await act(async () => {
      await result.current.create();
    });

    expect(apiMocks.createPracticeSession).toHaveBeenCalledWith({
      score_id: 'score-1',
      revision_id: 'revision-1',
      sample_rate: 16000,
      channels: 1,
      frame_format: 'pcm_s16le',
      progression_mode: 'WAIT_FOR_NOTE',
      realtime_guidance: 'GUIDED',
      evaluation_profile: 'LEARNING',
      input_source: 'MIDI',
      practice_scope: {
        start_expected_group_id: 'entry-4',
        end_expected_group_id: 'entry-6',
        start_measure_number: '12',
        end_measure_number: '12',
      },
    });
  });
});
