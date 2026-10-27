import { CONTINUOUS_ASSIGNMENT_POLICY_ID } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import { describe, expect, it } from 'vitest';
import artifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { assertCompletedEvaluation, ContinuousEvaluationSession } from '@/lib/practice/continuous/domain/evaluation/session';
import { buildContinuousExpectedStrikes } from '@/lib/practice/continuous/domain/evaluation/expected-strikes';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

const artifact = artifactJson as PracticeScoreArtifact;
const createSession = () => new ContinuousEvaluationSession({
  artifact, timeline: { beatToTimeMs: beat => beat * 1000 }, scope: { kind: 'FULL' }, sessionDomainId: 'test',
 inputSource: 'MICROPHONE', });

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
    session.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 20000, availabilitySessionTimeMs: 20100, observations: [] });
    const live = session.snapshot();
    session.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 20000, availabilitySessionTimeMs: 20100 });
    const completed = session.completedEvaluation();
    expect(completed.status).toBe('COMPLETE');
    if (completed.status !== 'COMPLETE') throw new Error('incomplete');
    expect(completed.assignment.groups).toEqual(live.assignment.groups);
    expect(completed.assignment.groups[0]).toBe(live.assignment.groups[0]);
  });
  it('keeps incomplete analysis unavailable until coverage arrives', () => {
    const session = createSession();
    session.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 100, availabilitySessionTimeMs: 100 });
    expect(session.completedEvaluation()).toEqual({ status: 'UNAVAILABLE', inputSource: 'MICROPHONE', assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, interpretationPolicyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1', reason: 'INCOMPLETE_ANALYSIS' });
    session.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 100, availabilitySessionTimeMs: 200, observations: [] });
    expect(session.completedEvaluation().status).toBe('COMPLETE');
    expect(session.snapshot().interpretation.groups.some(group => group.verdict === 'NOT_REACHED')).toBe(true);
  });
});


describe('source-bound evaluation composition', () => {
  it.each(['MIDI', 'MICROPHONE'] as const)('%s rejects foreign-source evidence before ledger mutation and fails closed', inputSource => {
    const session = new ContinuousEvaluationSession({ artifact, timeline: { beatToTimeMs: beat => beat * 1000 }, scope: { kind: 'FULL' }, sessionDomainId: 'test', inputSource });
    const before = session.snapshot();
    expect(() => session.publish({ publicationId: 'foreign', sessionDomainId: 'test', analyzedThroughPerformanceMs: 1000, availabilitySessionTimeMs: 1100,
      observations: [{ observationId: 'o', pitch: 'C4', performanceTimeMs: 100, confidence: 1, source: inputSource === 'MIDI' ? 'ACOUSTIC' : 'MIDI' }] })).toThrow('OBSERVATION_SOURCE_MISMATCH');
    expect(session.snapshot()).toEqual(before);
    expect(() => session.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 1000, availabilitySessionTimeMs: 1100 })).toThrow('OBSERVATION_SOURCE_MISMATCH');
    expect(session.completedEvaluation()).toEqual({ status: 'UNAVAILABLE', inputSource,
      assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, interpretationPolicyId: inputSource === 'MIDI' ? 'MIDI_PHYSICAL_NOTE_EVENTS_V1' : 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1', reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE' });
  });
  it('completed acoustic analysis without support is UNCONFIRMED, never UNAVAILABLE', () => {
    const session = createSession();
    session.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 20000, availabilitySessionTimeMs: 20100, observations: [] });
    session.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 20000, availabilitySessionTimeMs: 20100 });
    const result = session.completedEvaluation();
    expect(result.status).toBe('COMPLETE');
    if (result.status !== 'COMPLETE') throw new Error('incomplete');
    expect(result.interpretationPolicyId).toBe('ACOUSTIC_CONSERVATIVE_SUPPORT_V1');
    expect(result.interpretation.groups.every(group => group.verdict === 'UNCONFIRMED')).toBe(true);
    expect(result.assignment.groups.every(group => group.strikes.every(strike => strike.state === 'UNMATCHED'))).toBe(true);
  });
});

it.each(['assignmentPolicyId', 'interpretationPolicyId'] as const)('%s is retained on COMPLETE and UNAVAILABLE and rejects a different identity', key => {
  const session = createSession();
  const unavailable = session.completedEvaluation();
  session.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 20000, availabilitySessionTimeMs: 20100, observations: [] });
  session.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 20000, availabilitySessionTimeMs: 20100 });
  for (const result of [unavailable, session.completedEvaluation()]) {
    expect(result.assignmentPolicyId).toBe(CONTINUOUS_ASSIGNMENT_POLICY_ID);
    expect(result.interpretationPolicyId).toBe('ACOUSTIC_CONSERVATIVE_SUPPORT_V1');
    expect(() => assertCompletedEvaluation(result, 'MICROPHONE')).not.toThrow();
    const corrupt = JSON.parse(JSON.stringify(result)); corrupt[key] = 'wrong';
    expect(() => assertCompletedEvaluation(corrupt, 'MICROPHONE')).toThrow();
  }
});

it.each(['invalid observation', 'inconsistent group onset'])('completed evaluation delegates %s to the assignment boundary without repair', corruption => {
  const session = createSession();
  session.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 20000, availabilitySessionTimeMs: 20100,
    observations: [{ observationId: 'c', pitch: 'C4', performanceTimeMs: 0, confidence: 1, source: 'ACOUSTIC' }] });
  session.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 20000, availabilitySessionTimeMs: 20100 });
  const result = session.completedEvaluation(); if (result.status !== 'COMPLETE') throw new Error('incomplete');
  const parsed = JSON.parse(JSON.stringify(result)) as typeof result;
  expect(() => assertCompletedEvaluation(parsed, 'MICROPHONE')).not.toThrow();
  if (corruption === 'invalid observation') Object.assign(parsed.assignment.observations[0], { confidence: 2 });
  else Object.assign(parsed.assignment.groups[0], { performanceTimeMs: parsed.assignment.groups[0].performanceTimeMs + 1 });
  const before = structuredClone(parsed), serializedBefore = JSON.stringify(parsed);
  expect(() => assertCompletedEvaluation(parsed, 'MICROPHONE')).toThrow(/Continuous assignment/);
  expect(parsed).toEqual(before); expect(JSON.stringify(parsed)).toBe(serializedBefore);
});
