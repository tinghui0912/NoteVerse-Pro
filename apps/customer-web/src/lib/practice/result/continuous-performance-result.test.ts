import { ContinuousEvaluationSession } from '@/lib/practice/continuous/domain/evaluation/session';
import type { PracticeScoreArtifact } from '@/lib/practice/kernel/artifact';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { assertContinuousPerformanceResult, createContinuousPerformanceResult } from './continuous-performance-result';
import { canonicalContinuousResultFixture } from '@/lib/practice/__fixtures__/continuous-result';
import artifact from '@/lib/practice/__fixtures__/canonical-practice-score-artifact.json';

const clone = () => JSON.parse(JSON.stringify(canonicalContinuousResultFixture()));
describe('immutable Continuous product result', () => {
  it.each(['MIDI', 'MICROPHONE'] as const)('%s round-trips JSON with identities, metrics and complete assignment integrity', inputSource => {
    const result = canonicalContinuousResultFixture(inputSource);
    const parsed = JSON.parse(JSON.stringify(result));
    expect(() => assertContinuousPerformanceResult(parsed)).not.toThrow();
    expect(parsed).toEqual(result);
    expect(Object.isFrozen(result)).toBe(true); expect(Object.isFrozen(result.scope)).toBe(true);
    expect(Object.isFrozen(result.tempoPlan.segments)).toBe(true); expect(Object.isFrozen(result.evaluation)).toBe(true);
    expect(Object.isFrozen(result.metrics)).toBe(true); expect(Object.isFrozen(result.evidenceProvenance)).toBe(true);
    expectTypeOf<Extract<keyof Parameters<typeof createContinuousPerformanceResult>[0], 'metrics'>>().toEqualTypeOf<never>();
  });
  it.each([
    ['schema', (value: ReturnType<typeof clone>) => { value.schemaVersion = 2; }],
    ['session', (value: ReturnType<typeof clone>) => { value.localSessionId = 'foreign'; }],
    ['source', (value: ReturnType<typeof clone>) => { value.inputSource = 'STEP'; }],
    ['cross-source evaluation', (value: ReturnType<typeof clone>) => { value.inputSource = 'MICROPHONE'; }],
    ['cross-source provenance', (value: ReturnType<typeof clone>) => { value.evidenceProvenance = canonicalContinuousResultFixture('MICROPHONE').evidenceProvenance; }],
    ['metrics', (value: ReturnType<typeof clone>) => { value.metrics.correctStrikeCount++; }],
    ['metrics policy', (value: ReturnType<typeof clone>) => { value.metrics.metricsPolicyId = 'other'; }],
    ['metrics source', (value: ReturnType<typeof clone>) => { value.metrics.inputSource = 'MICROPHONE'; }],
    ['provenance', (value: ReturnType<typeof clone>) => { value.evidenceProvenance.evidencePolicyId = 'other'; }],
    ['completion date', (value: ReturnType<typeof clone>) => { value.completedAt = 'today'; }],
    ['elapsed', (value: ReturnType<typeof clone>) => { value.activeElapsedMs = -1; }],
    ['scope', (value: ReturnType<typeof clone>) => { value.scope.endIndex = -1; }],
    ['tempo', (value: ReturnType<typeof clone>) => { value.tempoPlan.segments[0].bpm = 0; }],
    ['media', (value: ReturnType<typeof clone>) => { value.media = new Blob(['forbidden']); }],
    ['non-JSON metadata', (value: ReturnType<typeof clone>) => { value.completedAt = new Date(); }],
  ] as const)('rejects corrupt %s without repair', (_name, corrupt) => {
    const value = clone(); corrupt(value); expect(() => assertContinuousPerformanceResult(value)).toThrow();
  });
  it.each(['MIDI', 'MICROPHONE'] as const)('%s result retains assigned observations and capture provenance through JSON', inputSource => {
    const base = canonicalContinuousResultFixture(inputSource), localSessionId = 'evidence-result';
    const evaluator = new ContinuousEvaluationSession({ artifact: artifact as PracticeScoreArtifact, inputSource, scope: { kind: 'FULL' },
      sessionDomainId: localSessionId, timeline: { beatToTimeMs: beat => beat * 500 } });
    const observation = { observationId: 'observed-C4', pitch: 'C4', performanceTimeMs: 0, confidence: .42,
      source: inputSource === 'MIDI' ? 'MIDI' as const : 'ACOUSTIC' as const,
      ...(inputSource === 'MICROPHONE' ? { provenance: { sourceDomainId: 'capture', sourceEventSample: 2400, sourceSampleRateHz: 48000 } } : {}) };
    evaluator.publish({ publicationId: 'evidence', sessionDomainId: localSessionId, observations: [observation],
      analyzedThroughPerformanceMs: 10000, availabilityTimeMs: 10000 });
    evaluator.complete({ reason: 'SCOPE_COMPLETED', performanceTimeMs: 10000, availabilityTimeMs: 10000 });
    const result = createContinuousPerformanceResult({ artifact: artifact as PracticeScoreArtifact, localSessionId, inputSource, scope: { kind: 'FULL' },
      tempoPlan: base.tempoPlan, activeElapsedMs: 10000, evaluation: evaluator.completedEvaluation(), evidenceProvenance: base.evidenceProvenance, completedAt: base.completedAt });
    const parsed = JSON.parse(JSON.stringify(result)); assertContinuousPerformanceResult(parsed);
    expect(parsed.evaluation.status).toBe('COMPLETE');
    if (parsed.evaluation.status !== 'COMPLETE') throw new Error('incomplete');
    expect(parsed.evaluation.assignment.observations).toEqual([observation]);
    expect(parsed.evaluation.assignment.observationAssignments).toMatchObject([{ kind: 'STRIKE_MATCH', observationId: observation.observationId }]);
  });
  it('unavailable evaluation retains canonical target count, identities and provenance without fabricated outcomes', () => {
    const result = canonicalContinuousResultFixture('MICROPHONE', 44100, false);
    expect(result.metrics).toEqual({ status: 'UNAVAILABLE', inputSource: 'MICROPHONE', metricsPolicyId: 'CONTINUOUS_PRODUCT_METRICS_V1',
      targetStrikeCount: artifact.expectedPracticeGroups.flatMap(group => group.strikeTargets).length, reason: 'CONTINUOUS_ANALYSIS_UNAVAILABLE' });
    expect(result.evaluation).toMatchObject({ status: 'UNAVAILABLE', assignmentPolicyId: 'CONTINUOUS_EXACT_PITCH_ASSIGNMENT_FINALITY_V1',
      interpretationPolicyId: 'ACOUSTIC_CONSERVATIVE_SUPPORT_V1' });
    expect(result.evidenceProvenance).toMatchObject({ sourceSampleRateHz: 44100 });
    expect(() => assertContinuousPerformanceResult(JSON.parse(JSON.stringify(result)))).not.toThrow();
  });
  it('unavailable range target count comes from the original scoped canonical artifact', () => {
    const base = canonicalContinuousResultFixture('MICROPHONE', 48000, false);
    const group = artifact.expectedPracticeGroups[3];
    const result = createContinuousPerformanceResult({ artifact: artifact as PracticeScoreArtifact, localSessionId: base.localSessionId,
      scope: { kind: 'RANGE', startGroupId: group.groupId, endGroupId: group.groupId }, inputSource: base.inputSource,
      tempoPlan: base.tempoPlan, activeElapsedMs: base.activeElapsedMs, evaluation: base.evaluation,
      evidenceProvenance: base.evidenceProvenance, completedAt: base.completedAt });
    expect(result.metrics).toMatchObject({ status: 'UNAVAILABLE', targetStrikeCount: 2 });
    expect(result.scope).toMatchObject({ kind: 'RANGE', startIndex: 3, endIndex: 3 });
  });
});
