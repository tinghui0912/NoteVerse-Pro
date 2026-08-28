import { describe, expect, it } from 'vitest';

import { practiceSummaryArtifactForSession } from './summary-artifact';
import type { PracticeSessionDetailRead } from '@/generated/practice-api';

function session(
  overrides: Partial<PracticeSessionDetailRead> = {}
): PracticeSessionDetailRead {
  return {
    session_id: 'session-1',
    score_id: 'score-1',
    revision_id: 'revision-1',
    access_origin: 'OWNER',
    state: 'FINISHED',
    progression_mode: 'WAIT_FOR_NOTE',
    realtime_guidance: 'GUIDED',
    evaluation_profile: 'LEARNING',
    input_source: 'MIDI',
    practice_scope: null,
    sample_rate: 16000,
    channels: 1,
    frame_format: 'pcm_s16le',
    started_at: null,
    finished_at: null,
    last_beat_position: null,
    last_confidence: null,
    summary_status: 'READY',
    completion_outcome: null,
    ...overrides,
  };
}

describe('practiceSummaryArtifactForSession', () => {
  it('uses learning-summary semantics for full-piece wait-for-note sessions', () => {
    expect(practiceSummaryArtifactForSession(session())).toMatchObject({
      kind: 'learning-summary',
      scopeKind: 'full-piece',
      evaluationProfile: 'LEARNING',
      accuracyLabelKey: 'learningAccuracy',
    });
  });

  it('uses performance-summary semantics for full-piece continuous sessions', () => {
    expect(
      practiceSummaryArtifactForSession(
        session({
          progression_mode: 'CONTINUOUS',
          realtime_guidance: 'STATUS_ONLY',
          evaluation_profile: 'PERFORMANCE',
          input_source: 'MICROPHONE',
        })
      )
    ).toMatchObject({
      kind: 'performance-summary',
      scopeKind: 'full-piece',
      evaluationProfile: 'PERFORMANCE',
      accuracyLabelKey: 'performanceAccuracy',
    });
  });

  it('keeps learning semantics for a selected wait-for-note range', () => {
    expect(
      practiceSummaryArtifactForSession(
        session({
          progression_mode: 'WAIT_FOR_NOTE',
          practice_scope: {
            start_expected_group_id: 'entry-1',
            end_expected_group_id: 'entry-3',
          },
        })
      )
    ).toMatchObject({
      kind: 'section-summary',
      scopeKind: 'selected-range',
      evaluationProfile: 'LEARNING',
      accuracyLabelKey: 'learningAccuracy',
    });
  });

  it('keeps performance semantics for a selected continuous range', () => {
    expect(
      practiceSummaryArtifactForSession(
        session({
          progression_mode: 'CONTINUOUS',
          realtime_guidance: 'STATUS_ONLY',
          evaluation_profile: 'PERFORMANCE',
          input_source: 'MICROPHONE',
          practice_scope: {
            start_expected_group_id: 'entry-1',
            end_expected_group_id: 'entry-3',
          },
        })
      )
    ).toMatchObject({
      kind: 'section-summary',
      scopeKind: 'selected-range',
      evaluationProfile: 'PERFORMANCE',
      accuracyLabelKey: 'performanceAccuracy',
    });
  });
});
