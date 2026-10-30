import { PracticeTempoTimeline } from '@/lib/practice/kernel/tempo';
import { continuousSessionPlan } from '@/lib/practice/__fixtures__/session-plan';
import { CONTINUOUS_ASSIGNMENT_POLICY_ID } from '@/lib/practice/continuous/domain/evaluation/finalization-policy';
import { describe, expect, it } from 'vitest';
import artifactJson from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import { assertCompletedEvaluation, ContinuousEvaluationSession } from '@/lib/practice/continuous/domain/evaluation/session';
import { buildContinuousExpectedStrikesFromTimeline } from '@/lib/practice/continuous/domain/evaluation/expected-strikes';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';

const artifact = artifactJson as PracticeScoreArtifact;
const createSession = () => new ContinuousEvaluationSession({ artifact, timeline: { beatToTimeMs: beat => beat * 1000 }, scope: continuousSessionPlan(artifact, { scope: { kind: 'FULL' } }).scope, sessionDomainId: 'test', inputSource: 'MICROPHONE' });

describe('artifact-bound Continuous evaluation session', () => {
  it('constructs canonical same-time strikes from each expected group onset', () => {
    const plan = continuousSessionPlan(artifact, { tempoSelection: { mode: 'CUSTOM_FIXED_BPM', bpm: 120 } });
    const strikes = buildContinuousExpectedStrikesFromTimeline(artifact, new PracticeTempoTimeline(plan.tempoPlan, artifact.scoreEndBeat), plan.scope);
    for (const group of artifact.moments) {
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
    expect(session.completedEvaluation()).toEqual({ status: 'UNAVAILABLE', inputSource: 'MICROPHONE', assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, reason: 'INCOMPLETE_ANALYSIS' });
    session.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 100, availabilitySessionTimeMs: 200, observations: [] });
    expect(session.completedEvaluation().status).toBe('COMPLETE');
    expect(session.snapshot().assignment.groups.some(group => group.strikes.some(strike => strike.state === 'NOT_REACHED'))).toBe(true);
  });
});


describe('source-bound evaluation composition', () => {
  it.each(['MIDI', 'MICROPHONE'] as const)('%s rejects foreign-source evidence before ledger mutation and fails closed', inputSource => {
    const session = new ContinuousEvaluationSession({ artifact, timeline: { beatToTimeMs: beat => beat * 1000 }, scope: continuousSessionPlan(artifact, { scope: { kind: 'FULL' } }).scope, sessionDomainId: 'test', inputSource });
    const before = session.snapshot();
    expect(() => session.publish({ publicationId: 'foreign', sessionDomainId: 'test', analyzedThroughPerformanceMs: 1000, availabilitySessionTimeMs: 1100,
      observations: [{ observationId: 'o', pianoKey: 60, performanceTimeMs: 100, confidence: 1, source: inputSource === 'MIDI' ? 'ACOUSTIC' : 'MIDI' }] })).toThrow('OBSERVATION_SOURCE_MISMATCH');
    expect(session.snapshot()).toEqual(before);
    expect(() => session.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 1000, availabilitySessionTimeMs: 1100 })).toThrow('OBSERVATION_SOURCE_MISMATCH');
    expect(session.completedEvaluation()).toEqual({ status: 'UNAVAILABLE', inputSource,
      assignmentPolicyId: CONTINUOUS_ASSIGNMENT_POLICY_ID, reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE' });
  });
  it('healthy completed acoustic analysis without support is UNMATCHED, never UNAVAILABLE', () => {
    const session = createSession();
    session.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 20000, availabilitySessionTimeMs: 20100, observations: [] });
    session.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 20000, availabilitySessionTimeMs: 20100 });
    const result = session.completedEvaluation();
    expect(result.status).toBe('COMPLETE');
    if (result.status !== 'COMPLETE') throw new Error('incomplete');
    expect(result.assignment.groups.every(group => group.strikes.every(strike => strike.state === 'UNMATCHED'))).toBe(true);
  });
});

it.each(['assignmentPolicyId'] as const)('%s is retained on COMPLETE and UNAVAILABLE and rejects a different identity', key => {
  const session = createSession();
  const unavailable = session.completedEvaluation();
  session.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 20000, availabilitySessionTimeMs: 20100, observations: [] });
  session.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 20000, availabilitySessionTimeMs: 20100 });
  for (const result of [unavailable, session.completedEvaluation()]) {
    expect(result.assignmentPolicyId).toBe(CONTINUOUS_ASSIGNMENT_POLICY_ID);
    expect(() => assertCompletedEvaluation(result, 'MICROPHONE')).not.toThrow();
    const corrupt = JSON.parse(JSON.stringify(result)); corrupt[key] = 'wrong';
    expect(() => assertCompletedEvaluation(corrupt, 'MICROPHONE')).toThrow();
  }
});

it.each(['invalid observation', 'inconsistent group onset'])('completed evaluation delegates %s to the assignment boundary without repair', corruption => {
  const session = createSession();
  session.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 20000, availabilitySessionTimeMs: 20100,
    observations: [{ observationId: 'c', pianoKey: 60, performanceTimeMs: 0, confidence: 1, source: 'ACOUSTIC' }] });
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

it.each(['MIDI', 'MICROPHONE'] as const)('%s completed evaluation has only exact assignment/source fields without repair', inputSource => {
  const session = new ContinuousEvaluationSession({ artifact, inputSource, sessionDomainId: 'test', scope: continuousSessionPlan(artifact, { scope: { kind: 'FULL' } }).scope, timeline: { beatToTimeMs: beat => beat * 1000 } });
  const unavailable = session.completedEvaluation();
  session.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 20000, availabilitySessionTimeMs: 20100, observations: [] });
  session.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 20000, availabilitySessionTimeMs: 20100 });
  for (const result of [unavailable, session.completedEvaluation()]) {
    expect(Object.keys(result).sort()).toEqual(['assignmentPolicyId', 'inputSource', result.status === 'COMPLETE' ? 'assignment' : 'reason', 'status'].sort());
    expect(() => assertCompletedEvaluation(result, inputSource)).not.toThrow();
    for (const field of ['interpretation', 'interpretationPolicyId', 'unknown']) {
      const parsed = JSON.parse(JSON.stringify(result)); parsed[field] = {};
      const before = structuredClone(parsed), serializedBefore = JSON.stringify(parsed);
      expect(() => assertCompletedEvaluation(parsed, inputSource)).toThrow('shape');
      expect(parsed).toEqual(before); expect(JSON.stringify(parsed)).toBe(serializedBefore);
      if (parsed.assignment) expect(Object.isFrozen(parsed.assignment.groups[0].strikes)).toBe(false);
    }
    const missing = JSON.parse(JSON.stringify(result)); delete missing.inputSource;
    expect(() => assertCompletedEvaluation(missing, inputSource)).toThrow();
    const invalid = JSON.parse(JSON.stringify(result)); invalid.status = 'OTHER';
    expect(() => assertCompletedEvaluation(invalid, inputSource)).toThrow();
    const wrongSource = JSON.parse(JSON.stringify(result)); wrongSource.inputSource = 'OTHER';
    expect(() => assertCompletedEvaluation(wrongSource, inputSource)).toThrow();
  }
  const badReason = JSON.parse(JSON.stringify(unavailable)); badReason.reason = 'OTHER';
  expect(() => assertCompletedEvaluation(badReason, inputSource)).toThrow('reason');
});

it.each(['MIDI', 'MICROPHONE'] as const)('%s parsed evaluation independently rejects foreign observation sources without mutation', inputSource => {
  const session = new ContinuousEvaluationSession({ artifact, inputSource, sessionDomainId: 'test', scope: continuousSessionPlan(artifact, { scope: { kind: 'FULL' } }).scope, timeline: { beatToTimeMs: beat => beat * 1000 } });
  session.publish({ publicationId: 'p', sessionDomainId: 'test', analyzedThroughPerformanceMs: 20000, availabilitySessionTimeMs: 20100,
    observations: [{ observationId: 'c', pianoKey: 60, performanceTimeMs: 0, confidence: 1, source: inputSource === 'MIDI' ? 'MIDI' : 'ACOUSTIC' }] });
  session.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 20000, availabilitySessionTimeMs: 20100 });
  const result = session.completedEvaluation(); if (result.status !== 'COMPLETE') throw Error('incomplete');
  const parsed = JSON.parse(JSON.stringify(result));
  const source = inputSource === 'MIDI' ? 'ACOUSTIC' : 'MIDI';
  for (const observation of parsed.assignment.observations) observation.source = source;
  for (const group of parsed.assignment.groups) for (const strike of group.strikes) {
    if (strike.state === 'MATCHED') strike.match.observation.source = source;
  }
  const before = structuredClone(parsed), serializedBefore = JSON.stringify(parsed);
  expect(() => assertCompletedEvaluation(parsed, inputSource)).toThrow('OBSERVATION_SOURCE_MISMATCH');
  expect(parsed).toEqual(before); expect(JSON.stringify(parsed)).toBe(serializedBefore);
  expect(Object.isFrozen(parsed.assignment.observations)).toBe(false);
});
