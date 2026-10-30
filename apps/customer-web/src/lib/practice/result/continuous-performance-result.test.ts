import { ContinuousEvaluationSession } from '@/lib/practice/continuous/domain/evaluation/session';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { assertContinuousPerformanceResult, createContinuousPerformanceResult } from './continuous-performance-result';
import { canonicalContinuousResultFixture } from '@/lib/practice/__fixtures__/continuous-result';
import artifact from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';
import type { CompletedContinuousAssignment } from '@/lib/practice/continuous/domain/evaluation/assignment-types';

const clone = () => JSON.parse(JSON.stringify(canonicalContinuousResultFixture()));

function resultWithRetainedEvidence() {
  const base = canonicalContinuousResultFixture();
  const evaluator = new ContinuousEvaluationSession({ artifact: artifact as PracticeScoreArtifact, inputSource: 'MIDI', scope: { kind: 'FULL' },
    sessionDomainId: base.localSessionId, timeline: { beatToTimeMs: beat => beat * 500 } });
  evaluator.publish({ publicationId: 'evidence', sessionDomainId: base.localSessionId, analyzedThroughPerformanceMs: 10000, availabilitySessionTimeMs: 3000,
    observations: [{ observationId: 'matched', pianoKey: 60, performanceTimeMs: 0, confidence: 1, source: 'MIDI',
      provenance: { sourceDomainId: 'capture', sourceSampleRateHz: 48000, sourceEventSample: 0 } },
    { observationId: 'non-target', pianoKey: 71, performanceTimeMs: 1500, confidence: 1, source: 'MIDI' },
    { observationId: 'unattributed', pianoKey: 76, performanceTimeMs: 6000, confidence: 1, source: 'MIDI' }] });
  evaluator.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 10000, availabilitySessionTimeMs: 4000 });
  return createContinuousPerformanceResult({ artifact: artifact as PracticeScoreArtifact, localSessionId: base.localSessionId,
    inputSource: 'MIDI', scope: { kind: 'FULL' }, tempoPlan: base.tempoPlan, activeElapsedMs: 10000,
    evaluation: evaluator.completedEvaluation(), evidenceProvenance: base.evidenceProvenance, completedAt: base.completedAt });
}

describe('parsed Result delegates retained local truth validation', () => {
  it('validates a successful JSON roundtrip without freezing or changing caller-owned assignment data', () => {
    const parsed = JSON.parse(JSON.stringify(resultWithRetainedEvidence())) as ReturnType<typeof resultWithRetainedEvidence>;
    if (parsed.evaluation.status !== 'COMPLETE') throw new Error('incomplete');
    const assignment = parsed.evaluation.assignment;
    const callerObjects = [assignment, ...assignment.observations,
      ...assignment.groups.flatMap(group => [group, ...group.strikes, ...group.strikes.map(strike => strike.renderNoteIds)]),
      ...assignment.unattributedObservations.map(row => row.observation)];
    expect(callerObjects.every(row => !Object.isFrozen(row))).toBe(true);
    const before = structuredClone(parsed), serializedBefore = JSON.stringify(parsed);
    expect(() => assertContinuousPerformanceResult(parsed)).not.toThrow();
    expect(callerObjects.every(row => !Object.isFrozen(row))).toBe(true);
    expect(parsed).toEqual(before); expect(JSON.stringify(parsed)).toBe(serializedBefore);
  });
  it.each(['matched pianoKey', 'matched timing offset', 'matched outside window', 'group onset', 'malformed observation', 'malformed provenance', 'unknown retained field'])('rejects %s at the assignment boundary without mutation', corruption => {
    const parsed = JSON.parse(JSON.stringify(resultWithRetainedEvidence())) as ReturnType<typeof resultWithRetainedEvidence>;
    expect(() => assertContinuousPerformanceResult(parsed)).not.toThrow();
    if (parsed.evaluation.status !== 'COMPLETE') throw new Error('incomplete');
    const assignment = parsed.evaluation.assignment;
    const matched = assignment.groups.flatMap(group => group.strikes).find(strike => strike.state === 'MATCHED')!;
    if (matched.state !== 'MATCHED') throw new Error('matched fixture required');
    const changeEvidence = (id: string, patch: Partial<CompletedContinuousAssignment['observations'][number]>) => {
      const ledger = assignment.observations.find(row => row.observationId === id)!;
      Object.assign(ledger, patch);
      Object.assign(matched.match.observation, patch);
    };
    let expectedError = 'Continuous assignment matched strike semantics are corrupt.';
    if (corruption === 'matched pianoKey') changeEvidence('matched', { pianoKey: 62 });
    if (corruption === 'matched timing offset') Object.assign(matched.match, { timingOffsetMs: 1 });
    if (corruption === 'matched outside window') {
      changeEvidence('matched', { performanceTimeMs: 251 }); Object.assign(matched.match, { timingOffsetMs: 251 });
    }
    if (corruption === 'group onset') {
      Object.assign(assignment.groups[0], { performanceTimeMs: 1 }); expectedError = 'Continuous assignment strike identity is corrupt.';
    }
    if (corruption === 'malformed observation') {
      changeEvidence('matched', { confidence: 1.1 }); expectedError = 'Continuous assignment observation is corrupt.';
    }
    if (corruption === 'malformed provenance') {
      changeEvidence('matched', { provenance: { sourceDomainId: 'capture', sourceSampleRateHz: 0, sourceEventSample: 0 } });
      expectedError = 'Continuous assignment observation provenance is corrupt.';
    }
    if (corruption === 'unknown retained field') {
      Object.assign(assignment, { extra: true }); expectedError = 'Continuous assignment assignment is corrupt.';
    }
    const before = structuredClone(parsed), serializedBefore = JSON.stringify(parsed);
    expect(() => assertContinuousPerformanceResult(parsed)).toThrow(expectedError);
    expect(parsed).toEqual(before); expect(JSON.stringify(parsed)).toBe(serializedBefore);
  });
});
describe('immutable Continuous product result', () => {
  it.each(['MIDI', 'MICROPHONE'] as const)('%s parsed Result and direct creation reject stopped evaluations while generic evaluation accepts them', inputSource => {
    const base = canonicalContinuousResultFixture(inputSource);
    const parsed = JSON.parse(JSON.stringify(base)); parsed.evaluation.assignment.completion.reason = 'STOPPED_BY_USER';
    expect(() => assertContinuousPerformanceResult(parsed)).toThrow('natural scope completion');
    const evaluator = new ContinuousEvaluationSession({ artifact: artifact as PracticeScoreArtifact, inputSource, scope: { kind: 'FULL' },
      sessionDomainId: base.localSessionId, timeline: { beatToTimeMs: beat => beat * 500 } });
    evaluator.publish({ publicationId: 'coverage', sessionDomainId: base.localSessionId, analyzedThroughPerformanceMs: 10000, availabilitySessionTimeMs: 3000, observations: [] });
    evaluator.complete({ reason: 'STOPPED_BY_USER', performanceTimeMs: 10000, availabilitySessionTimeMs: 3000 });
    const evaluation = evaluator.completedEvaluation();
    expect(evaluation.status).toBe('COMPLETE');
    expect(() => createContinuousPerformanceResult({ artifact: artifact as PracticeScoreArtifact, localSessionId: base.localSessionId,
      inputSource, scope: { kind: 'FULL' }, tempoPlan: base.tempoPlan, activeElapsedMs: 10000, evaluation,
      evidenceProvenance: base.evidenceProvenance, completedAt: base.completedAt })).toThrow('natural scope completion');
  });
  it.each(['MIDI', 'MICROPHONE'] as const)('%s round-trips JSON with identities and complete assignment integrity', inputSource => {
    const result = canonicalContinuousResultFixture(inputSource);
    const parsed = JSON.parse(JSON.stringify(result));
    expect(parsed.schemaVersion).toBe(7);
    expect(parsed.evidenceProvenance.timing.calibrationApplied).toBe(false);
    expect(() => assertContinuousPerformanceResult(parsed)).not.toThrow();
    expect(parsed).toEqual(result);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.scope)).toBe(true);
    expect(Object.isFrozen(result.tempoPlan.segments)).toBe(true); expect(Object.isFrozen(result.evaluation)).toBe(true);
    expect(result).not.toHaveProperty('metrics'); expect(Object.isFrozen(result.evidenceProvenance)).toBe(true);
    expectTypeOf<Extract<keyof Parameters<typeof createContinuousPerformanceResult>[0], 'metrics'>>().toEqualTypeOf<never>();
  });
  it.each([
    ['schema 1', (value: ReturnType<typeof clone>) => { value.schemaVersion = 1; }],
    ['schema 6', (value: ReturnType<typeof clone>) => { value.schemaVersion = 6; }],
    ['schema 5', (value: ReturnType<typeof clone>) => { value.schemaVersion = 5; }],
    ['assignment policy V3', (value: ReturnType<typeof clone>) => { value.evaluation.assignmentPolicyId = 'CONTINUOUS_EXACT_PITCH_ASSIGNMENT_FINALITY_V3'; }],
    ['schema 4', (value: ReturnType<typeof clone>) => { value.schemaVersion = 4; }],
    ['old interpretation tree', (value: ReturnType<typeof clone>) => { value.evaluation.interpretation = {}; }],
    ['retired MIDI policy', (value: ReturnType<typeof clone>) => { value.evaluation.interpretationPolicyId = 'MIDI_PHYSICAL_NOTE_EVENTS_V2'; }],
    ['retired acoustic policy', (value: ReturnType<typeof clone>) => { value.evaluation.interpretationPolicyId = 'ACOUSTIC_TARGET_DETECTION_V2'; }],
    ['schema 3', (value: ReturnType<typeof clone>) => { value.schemaVersion = 3; }],
    ['old assignment policy', (value: ReturnType<typeof clone>) => { value.evaluation.assignmentPolicyId = 'CONTINUOUS_EXACT_PITCH_ASSIGNMENT_FINALITY_V2'; }],
    ['old MIDI policy', (value: ReturnType<typeof clone>) => { value.evaluation.interpretationPolicyId = 'MIDI_PHYSICAL_NOTE_EVENTS_V1'; }],
    ['old acoustic policy', (value: ReturnType<typeof clone>) => { value.evaluation.interpretationPolicyId = 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1'; }],
    ['schema 2', (value: ReturnType<typeof clone>) => { value.schemaVersion = 2; }],
    ['extra metrics', (value: ReturnType<typeof clone>) => { value.metrics = {}; }],
    ['session', (value: ReturnType<typeof clone>) => { value.localSessionId = 'foreign'; }],
    ['source', (value: ReturnType<typeof clone>) => { value.inputSource = 'STEP'; }],
    ['cross-source evaluation', (value: ReturnType<typeof clone>) => { value.inputSource = 'MICROPHONE'; }],
    ['cross-source provenance', (value: ReturnType<typeof clone>) => { value.evidenceProvenance = canonicalContinuousResultFixture('MICROPHONE').evidenceProvenance; }],
    ['provenance', (value: ReturnType<typeof clone>) => { value.evidenceProvenance.evidencePolicyId = 'other'; }],
    ['timing mapping', (value: ReturnType<typeof clone>) => { value.evidenceProvenance.timing.eventTimeMappingPolicyId = 'OTHER'; }],
    ['calibration policy', (value: ReturnType<typeof clone>) => { value.evidenceProvenance.timing.calibrationPolicyId = 'MEASURED'; }],
    ['applied calibration', (value: ReturnType<typeof clone>) => { value.evidenceProvenance.timing.calibrationApplied = true; }],
    ['ambiguous finality field', (value: ReturnType<typeof clone>) => {
      const finality = value.evaluation.assignment.groups[0].finality;
      finality.finalizationTimeMs = finality.finalizationSessionTimeMs; delete finality.finalizationSessionTimeMs;
    }],
    ['completion date', (value: ReturnType<typeof clone>) => { value.completedAt = 'today'; }],
    ['elapsed', (value: ReturnType<typeof clone>) => { value.activeElapsedMs = -1; }],
    ['scope', (value: ReturnType<typeof clone>) => { value.scope.endIndex = -1; }],
    ['tempo', (value: ReturnType<typeof clone>) => { value.tempoPlan.segments[0].bpm = 0; }],
    ['media', (value: ReturnType<typeof clone>) => { value.media = new Blob(['forbidden']); }],
    ['non-JSON metadata', (value: ReturnType<typeof clone>) => { value.completedAt = new Date(); }],
  ] as const)('rejects corrupt %s without repair', (_name, corrupt) => {
    const value = clone(); corrupt(value); const before = structuredClone(value);
    expect(() => assertContinuousPerformanceResult(value)).toThrow(); expect(value).toEqual(before);
  });
  it.each(['MIDI', 'MICROPHONE'] as const)('%s result retains assigned observations and capture provenance through JSON', inputSource => {
    const base = canonicalContinuousResultFixture(inputSource), localSessionId = 'evidence-result';
    const evaluator = new ContinuousEvaluationSession({ artifact: artifact as PracticeScoreArtifact, inputSource, scope: { kind: 'FULL' },
      sessionDomainId: localSessionId, timeline: { beatToTimeMs: beat => beat * 500 } });
    const observation = { observationId: 'observed-C4', pianoKey: 60, performanceTimeMs: 0, confidence: .42,
      source: inputSource === 'MIDI' ? 'MIDI' as const : 'ACOUSTIC' as const,
      ...(inputSource === 'MICROPHONE' ? { provenance: { sourceDomainId: 'capture', sourceEventSample: 2400, sourceSampleRateHz: 48000 } } : {}) };
    evaluator.publish({ publicationId: 'evidence', sessionDomainId: localSessionId, observations: [observation],
      analyzedThroughPerformanceMs: 10000, availabilitySessionTimeMs: 3000 });
    evaluator.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 10000, availabilitySessionTimeMs: 4000 });
    const result = createContinuousPerformanceResult({ artifact: artifact as PracticeScoreArtifact, localSessionId, inputSource, scope: { kind: 'FULL' },
      tempoPlan: base.tempoPlan, activeElapsedMs: 10000, evaluation: evaluator.completedEvaluation(), evidenceProvenance: base.evidenceProvenance, completedAt: base.completedAt });
    const parsed = JSON.parse(JSON.stringify(result)); assertContinuousPerformanceResult(parsed);
    expect(parsed.evaluation.status).toBe('COMPLETE');
    if (parsed.evaluation.status !== 'COMPLETE') throw new Error('incomplete');
    expect(parsed.evaluation.assignment.observations).toEqual([observation]);
    expect(parsed.schemaVersion).toBe(7);
    expect(parsed.evaluation.assignment.completion).toMatchObject({ performanceTimeMs: 10000, availabilitySessionTimeMs: 4000 });
    expect(parsed.evaluation.assignment.groups[0].strikes[0].finality.finalizationSessionTimeMs).toBe(3000);
    expect(parsed.evidenceProvenance.timing).toMatchObject({ calibrationApplied: false,
      calibrationPolicyId: 'CONTINUOUS_NO_INPUT_TIMING_CALIBRATION_V1', eventTimeMappingPolicyId: inputSource === 'MIDI'
        ? 'MIDI_EVENT_TIMESTAMP_TO_PERFORMANCE_TIME_V1' : 'ACOUSTIC_SOURCE_EVENT_SAMPLE_TO_PERFORMANCE_TIME_V1' });
    expect(parsed.evaluation.assignment.observationAssignments).toMatchObject([{ kind: 'STRIKE_MATCH', observationId: observation.observationId }]);
  });
  it('unavailable evaluation retains identities and provenance without fabricated outcomes', () => {
    const result = canonicalContinuousResultFixture('MICROPHONE', 44100, false);
    expect(result).not.toHaveProperty('metrics');
    expect(result.evaluation).toMatchObject({ status: 'UNAVAILABLE', assignmentPolicyId: 'CONTINUOUS_EXACT_PIANO_KEY_ORDERED_ASSIGNMENT_FINALITY_V5' });
    expect(result.evidenceProvenance).toMatchObject({ sourceSampleRateHz: 44100 });
    expect(() => assertContinuousPerformanceResult(JSON.parse(JSON.stringify(result)))).not.toThrow();
  });
  it('unavailable range retains its original canonical scope', () => {
    const base = canonicalContinuousResultFixture('MICROPHONE', 48000, false);
    const group = artifact.moments[3];
    const result = createContinuousPerformanceResult({ artifact: artifact as PracticeScoreArtifact, localSessionId: base.localSessionId,
      scope: { kind: 'RANGE', startGroupId: group.groupId, endGroupId: group.groupId }, inputSource: base.inputSource,
      tempoPlan: base.tempoPlan, activeElapsedMs: base.activeElapsedMs, evaluation: base.evaluation,
      evidenceProvenance: base.evidenceProvenance, completedAt: base.completedAt });
    expect(result.evaluation.status).toBe('UNAVAILABLE'); expect(result).not.toHaveProperty('metrics');
    expect(result.scope).toMatchObject({ kind: 'RANGE', startIndex: 3, endIndex: 3 });
  });
});
