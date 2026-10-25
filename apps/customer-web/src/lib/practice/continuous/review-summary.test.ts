import { describe, expect, it } from 'vitest';
import { ContinuousAssignmentFinalizer } from './domain/evaluation/assignment-finalizer';
import { completedEvaluationFixture } from '../__fixtures__/continuous-evaluation';
import { continuousReviewSummary } from './review-summary';
import { unavailableContinuousEvaluation } from './domain/evaluation/session';
const scope = { kind: 'FULL' as const, startIndex: 0, endIndex: 0, startBeat: 0, terminalBeat: 4 };
describe('source-aware Continuous review summary', () => {
  const summarize = (inputSource: 'MIDI' | 'MICROPHONE', pitches: readonly string[]) => {
    const raw = new ContinuousAssignmentFinalizer('test', ['C4','D4'].map(pitch => ({ strikeId: pitch, groupId: 'g', pitch, expectedPerformanceTimeMs: 1000, renderNoteIds: [pitch] })));
    raw.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 3000, availabilityTimeMs: 3100,
      observations: pitches.map(pitch => ({ observationId: pitch, pitch, performanceTimeMs: 1000, confidence: 1, source: inputSource === 'MIDI' ? 'MIDI' : 'ACOUSTIC' })) });
    raw.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 3000, availabilityTimeMs: 3100 });
    const completed = raw.completedAssignment();
    if (completed.status !== 'COMPLETE') throw new Error('incomplete');
    return continuousReviewSummary({ artifact: null, scope, evaluation: completedEvaluationFixture(inputSource, completed.assignment.groups, completed.assignment.unattributedObservations.map(row => row.observation)) });
  };
  it('counts MIDI residual wrong observations independently from missing targets and extra events', () => {
    expect(summarize('MIDI', ['C4','E4'])).toEqual({ status: 'COMPLETE', inputSource: 'MIDI', targetStrikeCount: 2,
      correctStrikeCount: 1, missingStrikeCount: 1, wrongObservationCount: 1, extraObservationCount: 0, notReachedStrikeCount: 0 });
    expect(summarize('MIDI', ['C4','D4','E4'])).toMatchObject({ correctStrikeCount: 2, missingStrikeCount: 0, wrongObservationCount: 0, extraObservationCount: 1 });
  });
  it('never counts acoustic residuals as learner errors', () => {
    expect(summarize('MICROPHONE', ['C4','E4'])).toEqual({ status: 'COMPLETE', inputSource: 'MICROPHONE', targetStrikeCount: 2,
      supportedStrikeCount: 1, unconfirmedStrikeCount: 1, notReachedStrikeCount: 0 });
    expect(summarize('MICROPHONE', ['C4','D4','E4'])).toEqual({ status: 'COMPLETE', inputSource: 'MICROPHONE', targetStrikeCount: 2,
      supportedStrikeCount: 2, unconfirmedStrikeCount: 0, notReachedStrikeCount: 0 });
  });
  it('unavailable analysis has no invented learner counts', () => {
    expect(continuousReviewSummary({ artifact: null, scope, evaluation: unavailableContinuousEvaluation('MICROPHONE','CONTINUOUS_ANALYSIS_UNAVAILABLE') })).toEqual({
      status: 'UNAVAILABLE', inputSource: 'MICROPHONE', targetStrikeCount: 0, reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE' });
  });
});
