import { describe, expect, it } from 'vitest';

import {
  resolvePracticeCompletionOutcome,
  type PracticeCompletionOutcome,
} from './completion-outcome';
import type { PracticeSessionCompletionOutcomeRead } from '@/generated/practice-api';

function backendOutcome(
  overrides: Partial<PracticeSessionCompletionOutcomeRead> = {}
): PracticeSessionCompletionOutcomeRead {
  return {
    kind: 'FULL_PIECE_LEARNING',
    scope_kind: 'FULL_PIECE',
    summary_artifact_kind: 'LEARNING_SUMMARY',
    playback_expected: false,
    summary_available: false,
    ...overrides,
  };
}

describe('resolvePracticeCompletionOutcome', () => {
  it('maps selected-section sessions to lightweight section completion actions', () => {
    expect(
      resolvePracticeCompletionOutcome({
        completionOutcome: backendOutcome({
          kind: 'SELECTED_SECTION',
          scope_kind: 'SELECTED_RANGE',
          summary_artifact_kind: 'SECTION_SUMMARY',
        }),
      })
    ).toEqual({
      kind: 'selected-section',
      expectsPlayback: false,
      canViewSummary: false,
      canStartFullPiecePerformance: false,
    } satisfies PracticeCompletionOutcome);
  });

  it('maps full-piece continuous sessions to performance summary completion', () => {
    expect(
      resolvePracticeCompletionOutcome({
        completionOutcome: backendOutcome({
          kind: 'FULL_PIECE_PERFORMANCE',
          summary_artifact_kind: 'PERFORMANCE_SUMMARY',
          playback_expected: true,
          summary_available: true,
        }),
      })
    ).toEqual({
      kind: 'full-piece-performance',
      expectsPlayback: true,
      canViewSummary: true,
      canStartFullPiecePerformance: false,
    } satisfies PracticeCompletionOutcome);
  });

  it('maps full-piece wait-for-note sessions to learning completion without a summary CTA', () => {
    expect(
      resolvePracticeCompletionOutcome({
        completionOutcome: backendOutcome(),
      })
    ).toEqual({
      kind: 'full-piece-learning',
      expectsPlayback: false,
      canViewSummary: false,
      canStartFullPiecePerformance: true,
    } satisfies PracticeCompletionOutcome);
  });

  it('rejects missing backend completion outcome', () => {
    expect(() =>
      resolvePracticeCompletionOutcome({
        completionOutcome: null,
      })
    ).toThrow('Finished practice session is missing completion outcome.');
  });
});
