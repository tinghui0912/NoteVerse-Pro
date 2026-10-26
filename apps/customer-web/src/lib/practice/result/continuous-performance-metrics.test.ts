import { describe, expect, it } from 'vitest';
import { ContinuousAssignmentFinalizer } from '@/lib/practice/continuous/domain/evaluation/assignment-finalizer';
import { completedEvaluationFixture } from '@/lib/practice/__fixtures__/continuous-evaluation';
import { createContinuousPerformanceMetrics, CONTINUOUS_METRICS_POLICY_ID } from './continuous-performance-metrics';
import { unavailableContinuousEvaluation } from '@/lib/practice/continuous/domain/evaluation/session';
describe('source-aware Continuous performance metrics', () => {
  const summarize = (inputSource: 'MIDI' | 'MICROPHONE', pitches: readonly string[], targets: readonly string[] = ['C4','D4'], terminal = 3000) => {
    const raw = new ContinuousAssignmentFinalizer('test', targets.map(pitch => ({ strikeId: pitch, groupId: 'g', pitch, expectedPerformanceTimeMs: 1000, renderNoteIds: [pitch] })));
    raw.complete({ reason: terminal < 1000 ? 'STOPPED_BY_USER' : 'SCOPE_COMPLETED', performanceTimeMs: terminal, availabilitySessionTimeMs: 3100 });
    raw.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: terminal, availabilitySessionTimeMs: 3100,
      observations: pitches.map(pitch => ({ observationId: pitch, pitch, performanceTimeMs: 1000, confidence: 1, source: inputSource === 'MIDI' ? 'MIDI' : 'ACOUSTIC' })) });
    const completed = raw.completedAssignment();
    if (completed.status !== 'COMPLETE') throw new Error('incomplete');
    return createContinuousPerformanceMetrics(completedEvaluationFixture(inputSource, completed.assignment.groups, completed.assignment.unattributedObservations.map(row => row.observation)), targets.length);
  };
  it.each([
    { pitches: ['C4','E4'], correct: 1, wrong: 1, missing: 0, extra: 0 },
    { pitches: ['C4'], correct: 1, wrong: 0, missing: 1, extra: 0 },
    { pitches: ['E4'], correct: 0, wrong: 1, missing: 1, extra: 0 },
    { pitches: ['E4','F4'], correct: 0, wrong: 2, missing: 0, extra: 0 },
    { pitches: ['C4','D4','E4'], correct: 2, wrong: 0, missing: 0, extra: 1 },
    { pitches: ['C4','E4','F4'], correct: 1, wrong: 1, missing: 0, extra: 1 },
    { pitches: [], correct: 0, wrong: 0, missing: 2, extra: 0 },
  ])('$pitches partitions MIDI targets independently from additional playing', ({ pitches, correct, wrong, missing, extra }) => {
    const result = summarize('MIDI', pitches);
    expect(result).toEqual({ metricsPolicyId: CONTINUOUS_METRICS_POLICY_ID, status: 'COMPLETE', inputSource: 'MIDI', targetStrikeCount: 2, correctStrikeCount: correct,
      wrongStrikeCount: wrong, missingStrikeCount: missing, notReachedStrikeCount: 0, extraObservationCount: extra });
    if (result.status !== 'COMPLETE' || result.inputSource !== 'MIDI') throw new Error('source');
    expect(result.targetStrikeCount).toBe(result.correctStrikeCount + result.wrongStrikeCount + result.missingStrikeCount + result.notReachedStrikeCount);
  });
  it.each(['MIDI','MICROPHONE'] as const)('%s keeps its target partition for multiple chord sizes and terminal coverage', inputSource => {
    for (let size = 1; size <= 6; size++) {
      const targets = Array.from({ length: size }, (_, i) => 'C' + (i + 1));
      for (const mask of [0, (1 << size) - 1, 21 & ((1 << size) - 1), 12 & ((1 << size) - 1)]) {
        const pitches = [...targets.filter((_, i) => mask & (1 << i)), 'F#6', 'G#6'];
        const result = summarize(inputSource, pitches, targets);
        if (result.status !== 'COMPLETE') throw new Error('incomplete');
        if (result.inputSource === 'MIDI') {
          expect(result.targetStrikeCount).toBe(result.correctStrikeCount + result.wrongStrikeCount + result.missingStrikeCount + result.notReachedStrikeCount);
        } else {
          expect(result.targetStrikeCount).toBe(result.supportedStrikeCount + result.unconfirmedStrikeCount + result.notReachedStrikeCount);
          expect(Object.keys(result).sort()).toEqual(['inputSource','metricsPolicyId','notReachedStrikeCount','status','supportedStrikeCount','targetStrikeCount','unconfirmedStrikeCount']);
        }
      }
      const stopped = summarize(inputSource, [], targets, 500);
      expect(stopped).toMatchObject({ targetStrikeCount: size, notReachedStrikeCount: size });
    }
  });
  it('never counts acoustic residuals as learner errors', () => {
    expect(summarize('MICROPHONE', ['C4','E4'])).toEqual({ metricsPolicyId: CONTINUOUS_METRICS_POLICY_ID, status: 'COMPLETE', inputSource: 'MICROPHONE', targetStrikeCount: 2,
      supportedStrikeCount: 1, unconfirmedStrikeCount: 1, notReachedStrikeCount: 0 });
    expect(summarize('MICROPHONE', ['C4','D4','E4'])).toEqual({ metricsPolicyId: CONTINUOUS_METRICS_POLICY_ID, status: 'COMPLETE', inputSource: 'MICROPHONE', targetStrikeCount: 2,
      supportedStrikeCount: 2, unconfirmedStrikeCount: 0, notReachedStrikeCount: 0 });
  });
  it('unavailable analysis has no invented learner counts', () => {
    expect(createContinuousPerformanceMetrics(unavailableContinuousEvaluation('MICROPHONE','CONTINUOUS_ANALYSIS_UNAVAILABLE'), 2)).toEqual({
      metricsPolicyId: CONTINUOUS_METRICS_POLICY_ID, status: 'UNAVAILABLE', inputSource: 'MICROPHONE', targetStrikeCount: 2, reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE' });
  });
});
