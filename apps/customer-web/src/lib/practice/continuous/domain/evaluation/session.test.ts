import { describe, expect, it } from 'vitest';
import artifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { ContinuousEvaluationSession } from '@/lib/practice/continuous/domain/evaluation/session';
import { buildContinuousExpectedStrikes } from '@/lib/practice/continuous/domain/evaluation/expected-strikes';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

const artifact = artifactJson as PracticeScoreArtifact;
const createSession = () => new ContinuousEvaluationSession({
  artifact, timeline: { beatToTimeMs: beat => beat * 1000 }, scope: { kind: 'FULL' }, sessionDomainId: 'test',
});

describe('artifact-bound Continuous evaluation session', () => {
  it('constructs canonical same-time strikes from each expected group onset', () => {
    const strikes = buildContinuousExpectedStrikes({ artifact, scope: { kind: 'FULL' }, tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 120 } });
    for (const group of artifact.expectedPracticeGroups) {
      const times = strikes.filter(strike => strike.groupId === group.groupId).map(strike => strike.expectedPerformanceTimeMs);
      expect(new Set(times).size).toBe(1);
      expect(times[0]).toBe(group.onsetBeat * 500);
    }
  });
  it('completes from the same accumulated groups, without an offline evaluator', () => {
    const session = createSession();
    session.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 20000, availabilityTimeMs: 20100, observations: [] });
    const live = session.snapshot();
    session.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 20000, availabilityTimeMs: 20100 });
    const completed = session.completedEvaluation();
    expect(completed.status).toBe('COMPLETE');
    if (completed.status !== 'COMPLETE') throw new Error('incomplete');
    expect(completed.groups).toEqual(live.groups);
    expect(completed.groups[0]).toBe(live.groups[0]);
  });
  it('keeps incomplete analysis unavailable until coverage arrives', () => {
    const session = createSession();
    session.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 100, availabilityTimeMs: 100 });
    expect(session.completedEvaluation()).toEqual({ status: 'UNAVAILABLE', reason: 'INCOMPLETE_ANALYSIS' });
    session.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 100, availabilityTimeMs: 200, observations: [] });
    expect(session.completedEvaluation().status).toBe('COMPLETE');
    expect(session.snapshot().groups.some(group => group.verdict === 'NOT_REACHED')).toBe(true);
  });
});
